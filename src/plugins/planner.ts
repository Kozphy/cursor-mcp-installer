import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { asPathList, type PluginManifest } from './manifest.js';
import { resolveInside } from '../security/path-safety.js';
import { decideCapability, type CapabilityDecision } from '../security/policy.js';
import type { ApprovalSet } from '../security/approval.js';
import { checkClientCompatibility } from './compatibility.js';

export interface PlannedFile {
  relativePath: string;
  absolutePath: string;
}

export interface InstallPlan {
  name: string;
  version: string;
  files: PlannedFile[];
  decisions: CapabilityDecision[];
  compatible: boolean;
  compatibilityReason: string;
  blockers: string[];
}

export function planPluginInstall(
  pluginRoot: string,
  manifest: PluginManifest,
  approvals: ApprovalSet,
  cursorVersion: string,
): InstallPlan {
  const decisions: CapabilityDecision[] = [];
  const files: PlannedFile[] = [];
  const blockers: string[] = [];

  const compatibility = checkClientCompatibility(manifest.minClientVersions, 'cursor', cursorVersion);
  if (!compatibility.compatible) blockers.push(compatibility.reason);

  for (const component of ['skills', 'rules', 'commands', 'agents'] as const) {
    const paths = asPathList(manifest[component]);
    if (paths.length === 0) continue;
    const decision = decideCapability(component, paths.join(', '), true);
    decisions.push(decision);
    for (const pattern of paths) {
      try {
        for (const file of expandPattern(pluginRoot, pattern)) files.push(file);
      } catch (err) {
        blockers.push(`${component}: ${err instanceof Error ? err.message : String(err)}`);
        decisions.push({ component, risk: 'high', status: 'rejected', detail: String(err) });
      }
    }
  }

  if (manifest.hooks) {
    const decision = decideCapability('hooks', 'hooks can execute code', approvals.hooks);
    decisions.push(decision);
    if (decision.status === 'approval_required') {
      blockers.push('hooks require explicit approval and were not installed');
    }
  }

  if (manifest.mcpServers) {
    const decision = decideCapability(
      'mcp_command',
      'plugin declares MCP servers; client config is not modified unless write approval is set',
      approvals.mcpWrite,
    );
    decisions.push(decision);
    if (!approvals.mcpWrite) {
      blockers.push('mcpServers require explicit write approval; refusing to modify client config');
    }
  }

  return {
    name: manifest.name,
    version: manifest.version ?? '0.0.0',
    files,
    decisions,
    compatible: compatibility.compatible,
    compatibilityReason: compatibility.reason,
    blockers,
  };
}

function expandPattern(root: string, pattern: string): PlannedFile[] {
  const cleaned = pattern.replace(/^\.\//, '');
  if (cleaned.includes('*')) {
    const dir = cleaned.split('*')[0].replace(/\/$/, '') || '.';
    const base = resolveInside(root, dir);
    return walkFiles(root, base);
  }
  const absolutePath = resolveInside(root, cleaned);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing path ${pattern}`);
  }
  if (statSync(absolutePath).isDirectory()) return walkFiles(root, absolutePath);
  return [{ relativePath: relative(root, absolutePath), absolutePath }];
}

function walkFiles(root: string, dir: string): PlannedFile[] {
  const out: PlannedFile[] = [];
  for (const name of readdirSync(dir)) {
    const absolutePath = join(dir, name);
    const stat = statSync(absolutePath);
    if (stat.isSymbolicLink()) {
      resolveInside(root, relative(root, absolutePath));
    }
    if (stat.isDirectory()) out.push(...walkFiles(root, absolutePath));
    else out.push({ relativePath: relative(root, absolutePath).split('\\').join('/'), absolutePath });
  }
  return out;
}
