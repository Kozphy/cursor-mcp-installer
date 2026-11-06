import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execNoShell } from '../security/process.js';
import { parsePinnedGitUrl, resolveInside } from '../security/path-safety.js';
import { localProvenance, type Provenance } from '../security/provenance.js';
import type { ApprovalSet } from '../security/approval.js';

export interface ResolvedSource {
  pluginRoot: string;
  provenance: Provenance;
}

export async function resolvePluginSource(
  marketplaceRoot: string,
  source: string,
  approvals: ApprovalSet,
): Promise<ResolvedSource> {
  if (source.startsWith('https://') || source.startsWith('http://')) {
    if (!approvals.remote) {
      throw new Error('Remote plugin source requires explicit approval');
    }
    const pinned = parsePinnedGitUrl(source);
    const dir = mkdtempSync(join(tmpdir(), 'cursor-plugin-src-'));
    await execNoShell('git', ['init', dir], { timeout: 15000 });
    await execNoShell('git', ['remote', 'add', 'origin', pinned.cloneUrl], { cwd: dir, timeout: 15000 });
    await execNoShell('git', ['fetch', '--depth', '1', 'origin', pinned.commit], { cwd: dir, timeout: 60000 });
    await execNoShell('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: dir, timeout: 15000 });
    const revision = pinned.commit;
    return { pluginRoot: dir, provenance: { kind: 'git-commit', identity: pinned.cloneUrl, revision, schemaSha: localProvenance('', '').schemaSha } };
  }

  const pluginRoot = resolveInside(marketplaceRoot, source);
  if (!statSync(pluginRoot).isDirectory()) {
    throw new Error(`Plugin source is not a directory: ${source}`);
  }
  const manifestBytes = readFileSync(join(pluginRoot, '.cursor-plugin', 'plugin.json'));
  const revision = createHash('sha256').update(manifestBytes).digest('hex');
  return { pluginRoot, provenance: localProvenance(pluginRoot, revision) };
}
