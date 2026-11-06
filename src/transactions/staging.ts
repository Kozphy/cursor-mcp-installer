import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { PlannedFile } from '../plugins/planner.js';

export interface StagedInstall {
  dir: string;
  files: Array<{ relativePath: string; sha256: string }>;
}

export function stageFiles(files: PlannedFile[]): StagedInstall {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-plugin-stage-'));
  const staged: StagedInstall['files'] = [];
  for (const file of files) {
    const target = join(dir, file.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.absolutePath, target);
    const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
    staged.push({ relativePath: file.relativePath, sha256 });
  }
  return { dir, files: staged };
}

export function discardStage(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
