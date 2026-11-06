import { appendFileSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadMarketplace, searchMarketplace, type MarketplaceEntry } from './marketplace.js';
import { readPluginManifest } from './manifest.js';
import { resolvePluginSource } from './resolver.js';
import { planPluginInstall, type InstallPlan } from './planner.js';
import { readState, writeState, stateHome, type InstalledPluginRecord } from './state.js';
import { stageFiles, discardStage } from '../transactions/staging.js';
import { commitStage, restoreSnapshot, snapshotInstall } from '../transactions/rollback.js';
import { approvalsFromFlags, type ApprovalSet } from '../security/approval.js';
import { redactSecrets } from '../security/secret-redaction.js';
import { LIFECYCLE, type StageResult } from './lifecycle.js';

export interface PluginOperationOptions {
  marketplacePath: string;
  cursorVersion?: string;
  approveHooks?: boolean;
  approveRemote?: boolean;
  writeMcp?: boolean;
  dryRun?: boolean;
  variables?: Record<string, unknown>;
}

export interface PluginOperationResult {
  ok: boolean;
  stages: StageResult[];
  plan?: InstallPlan;
  record?: InstalledPluginRecord;
}

function audit(event: Record<string, unknown>): void {
  const dir = stateHome();
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'audit.log'), JSON.stringify(redactSecrets(event)) + '\n', 'utf8');
}

function validateVariables(planName: string, schema: { required?: string[]; properties?: Record<string, { type?: string }> } | undefined, values: Record<string, unknown> | undefined): string | null {
  if (!schema) return null;
  const provided = values ?? {};
  for (const key of schema.required ?? []) {
    if (!(key in provided)) return `${planName} missing required variable ${key}`;
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (!(key in provided) || !spec.type) continue;
    if (typeof provided[key] !== spec.type) return `${key} expected ${spec.type}`;
  }
  return null;
}

export async function installPlugin(name: string, options: PluginOperationOptions): Promise<PluginOperationResult> {
  const stages: StageResult[] = [];
  const note = (stage: StageResult['stage'], status: StageResult['status'], detail: string) => {
    stages.push({ stage, status, detail });
  };
  const approvals: ApprovalSet = approvalsFromFlags(options);
  const cursorVersion = options.cursorVersion ?? '0.0.0';

  note('DISCOVER', 'ok', options.marketplacePath);
  const loaded = loadMarketplace(options.marketplacePath);
  const entry = loaded.marketplace.plugins.find((plugin) => plugin.name === name);
  if (!entry) {
    note('VALIDATE', 'failed', `Plugin not in marketplace: ${name}`);
    return { ok: false, stages };
  }

  const resolved = await resolvePluginSource(loaded.root, entry.source, approvals);
  note('RESOLVE', 'ok', resolved.provenance.revision);
  const manifestResult = readPluginManifest(resolved.pluginRoot);
  if (!manifestResult.manifest) {
    note('VALIDATE', 'failed', manifestResult.diagnostics.map((item) => item.message).join('; '));
    return { ok: false, stages };
  }
  if (manifestResult.manifest.name !== entry.name) {
    note('VALIDATE', 'failed', `Manifest name ${manifestResult.manifest.name} does not match marketplace ${entry.name}`);
    return { ok: false, stages };
  }
  note('VALIDATE', 'ok', 'schema and identity match');
  note('INSPECT', 'ok', `version ${manifestResult.manifest.version ?? 'unversioned'}`);

  const variableError = validateVariables(name, manifestResult.manifest.variables, options.variables);
  if (variableError) {
    note('PLAN', 'failed', variableError);
    return { ok: false, stages };
  }

  const plan = planPluginInstall(resolved.pluginRoot, manifestResult.manifest, approvals, cursorVersion);
  note('PLAN', plan.blockers.length ? 'blocked' : 'ok', plan.blockers.join('; ') || plan.compatibilityReason);
  if (plan.blockers.length) {
    note('APPROVE', 'blocked', 'explicit approval or compatibility required');
    audit({ action: 'plugin.install', name, ok: false, blockers: plan.blockers });
    return { ok: false, stages, plan };
  }
  note('APPROVE', 'ok', 'no outstanding approval blockers');

  if (options.dryRun) {
    note('STAGE', 'ok', 'dry-run');
    note('VERIFY', 'ok', 'dry-run');
    note('COMMIT', 'ok', 'dry-run');
    note('AUDIT', 'ok', 'dry-run');
    return { ok: true, stages, plan };
  }

  const existing = readState().plugins[name];
  if (existing && existing.revision === resolved.provenance.revision) {
    note('COMMIT', 'ok', 'already installed');
    note('AUDIT', 'ok', 'idempotent');
    return { ok: true, stages, plan, record: existing };
  }

  const backup = snapshotInstall(name);
  const staged = stageFiles(plan.files);
  note('STAGE', 'ok', staged.dir);
  try {
    for (const file of staged.files) {
      const bytes = readFileSync(join(staged.dir, file.relativePath));
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== file.sha256) throw new Error(`checksum mismatch for ${file.relativePath}`);
    }
    note('VERIFY', 'ok', `${staged.files.length} files`);
    commitStage(name, staged.dir);
    const record: InstalledPluginRecord = {
      name,
      version: plan.version,
      source: entry.source,
      revision: resolved.provenance.revision,
      installedAt: new Date().toISOString(),
      files: staged.files.map((file) => ({
        path: join(stateHome(), 'installed', name, file.relativePath),
        sha256: file.sha256,
      })),
      components: plan.decisions.map((decision) => ({
        component: decision.component,
        status: decision.status,
        detail: decision.detail,
      })),
    };
    const state = readState();
    state.plugins[name] = record;
    writeState(state);
    note('COMMIT', 'ok', record.revision);
    audit({ action: 'plugin.install', name, revision: record.revision, ok: true });
    note('AUDIT', 'ok', 'recorded');
    discardStage(staged.dir);
    return { ok: true, stages, plan, record };
  } catch (err) {
    restoreSnapshot(name, backup);
    discardStage(staged.dir);
    const message = err instanceof Error ? err.message : String(err);
    note('COMMIT', 'failed', message);
    audit({ action: 'plugin.install', name, ok: false, error: message });
    return { ok: false, stages, plan };
  }
}

export async function listPlugins(marketplacePath: string, query = ''): Promise<MarketplaceEntry[]> {
  const { marketplace } = loadMarketplace(marketplacePath);
  return searchMarketplace(marketplace, query);
}

export async function inspectPlugin(name: string, options: PluginOperationOptions): Promise<PluginOperationResult> {
  return installPlugin(name, { ...options, dryRun: true });
}

export async function verifyPlugin(name: string): Promise<{ ok: boolean; detail: string }> {
  const record = readState().plugins[name];
  if (!record) return { ok: false, detail: 'not installed' };
  for (const file of record.files) {
    if (!existsSync(file.path)) return { ok: false, detail: `missing ${file.path}` };
    const digest = createHash('sha256').update(readFileSync(file.path)).digest('hex');
    if (digest !== file.sha256) return { ok: false, detail: `modified ${file.path}` };
  }
  return { ok: true, detail: 'checksums match' };
}

export async function uninstallPlugin(name: string): Promise<{ ok: boolean; kept: string[] }> {
  const state = readState();
  const record = state.plugins[name];
  if (!record) return { ok: true, kept: [] };
  const kept: string[] = [];
  for (const file of record.files) {
    if (!existsSync(file.path)) continue;
    const digest = createHash('sha256').update(readFileSync(file.path)).digest('hex');
    if (digest !== file.sha256) {
      kept.push(file.path);
      continue;
    }
    rmSync(file.path, { force: true });
  }
  if (kept.length === 0) {
    rmSync(join(stateHome(), 'installed', name), { recursive: true, force: true });
  }
  delete state.plugins[name];
  writeState(state);
  audit({ action: 'plugin.uninstall', name, kept });
  return { ok: true, kept };
}

export async function updatePlugin(name: string, options: PluginOperationOptions): Promise<PluginOperationResult> {
  return installPlugin(name, options);
}

export function lifecycleNames(): readonly string[] {
  return LIFECYCLE;
}

export function writeAuditMarker(dir: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'marker.txt'), text, 'utf8');
}
