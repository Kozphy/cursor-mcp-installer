import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stateHome } from '../plugins/state.js';

export function snapshotInstall(name: string): string | null {
  const current = join(stateHome(), 'installed', name);
  if (!existsSync(current)) return null;
  const backup = join(stateHome(), 'rollback', name, String(Date.now()));
  mkdirSync(backup, { recursive: true });
  cpSync(current, backup, { recursive: true });
  return backup;
}

export function restoreSnapshot(name: string, backup: string | null): void {
  const current = join(stateHome(), 'installed', name);
  rmSync(current, { recursive: true, force: true });
  if (backup && existsSync(backup)) {
    mkdirSync(join(stateHome(), 'installed'), { recursive: true });
    cpSync(backup, current, { recursive: true });
  }
}

export function commitStage(name: string, stageDir: string): void {
  const current = join(stateHome(), 'installed', name);
  rmSync(current, { recursive: true, force: true });
  mkdirSync(join(stateHome(), 'installed'), { recursive: true });
  cpSync(stageDir, current, { recursive: true });
}
