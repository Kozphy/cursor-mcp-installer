import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface OwnedFile {
  path: string;
  sha256: string;
}

export interface InstalledPluginRecord {
  name: string;
  version: string;
  source: string;
  revision: string;
  installedAt: string;
  files: OwnedFile[];
  components: Array<{ component: string; status: string; detail: string }>;
}

export interface InstallerState {
  plugins: Record<string, InstalledPluginRecord>;
}

export function stateHome(): string {
  return process.env.MCP_INSTALLER_HOME ?? join(homedir(), '.universal-mcp-installer');
}

export function statePath(): string {
  return join(stateHome(), 'plugins.json');
}

export function readState(): InstallerState {
  const file = statePath();
  if (!existsSync(file)) return { plugins: {} };
  return JSON.parse(readFileSync(file, 'utf8')) as InstallerState;
}

export function writeState(state: InstallerState): void {
  const home = stateHome();
  mkdirSync(home, { recursive: true });
  const file = statePath();
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  try {
    chmodSync(temp, 0o600);
  } catch {
    // Windows ACLs are not POSIX modes.
  }
  renameSync(temp, file);
}
