import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ClientWriter, McpServerEntry, WriteResult } from './types.js';
import { readJsonFile, backupFile, writeJsonFile, mergeServerIntoConfig } from '../utils/config-io.js';
import { log } from '../utils/logging.js';

/**
 * Resolve Claude Code user config path.
 * Default: ~/.claude.json
 * If CLAUDE_CONFIG_DIR is set, Claude Code reads .claude.json from that directory.
 */
export function getClaudeCodeUserConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) {
    return path.join(configDir, '.claude.json');
  }
  return path.join(os.homedir(), '.claude.json');
}

/**
 * On Windows, npx/npm/uvx are .cmd shims. Claude Code spawns without a shell,
 * so wrap them with `cmd /c` for reliable stdio MCP startup.
 */
function toClaudeCodeStdioEntry(config: McpServerEntry): Record<string, unknown> {
  let command = config.command ?? 'npx';
  let args = [...(config.args ?? [])];

  if (
    process.platform === 'win32' &&
    (command === 'npx' || command === 'npm' || command === 'uvx')
  ) {
    args = ['/c', command, ...args];
    command = 'cmd';
  }

  const entry: Record<string, unknown> = {
    command,
    args,
  };
  if (config.env && Object.keys(config.env).length > 0) {
    entry.env = config.env;
  }
  if (config.cwd) {
    entry.cwd = config.cwd;
  }
  return entry;
}

export function isClaudeCliAvailable(): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('where.exe', ['claude'], { timeout: 3000, stdio: 'pipe', shell: false });
      return true;
    }
    execFileSync('claude', ['--version'], { timeout: 3000, stdio: 'pipe', shell: false });
    return true;
  } catch {
    return false;
  }
}

export class ClaudeCodeWriter implements ClientWriter {
  readonly name = 'Claude Code';
  readonly id = 'claude-code';

  private getConfigPath(): string {
    return getClaudeCodeUserConfigPath();
  }

  getConfigKey(): string {
    return 'mcpServers';
  }

  detect() {
    const configPath = this.getConfigPath();
    const installed =
      fs.existsSync(configPath) ||
      fs.existsSync(path.join(os.homedir(), '.claude')) ||
      isClaudeCliAvailable();
    let existing: Record<string, unknown> | null = null;
    try {
      existing = readJsonFile(configPath);
    } catch {
      /* may not exist */
    }
    return { installed, configPath, existing };
  }

  write(serverName: string, config: McpServerEntry): WriteResult {
    const configPath = this.getConfigPath();
    try {
      const backupPath = backupFile(configPath);
      let existing = readJsonFile(configPath) ?? { mcpServers: {} };

      // User-scope servers live under top-level mcpServers in ~/.claude.json
      // (not project-local .mcp.json, and not only under projects.<path>).
      const entry = toClaudeCodeStdioEntry(config);
      existing = mergeServerIntoConfig(existing, 'mcpServers', serverName, entry);
      writeJsonFile(configPath, existing);

      log.info(`Wrote Claude Code config for ${serverName}`, { path: configPath });
      return { success: true, configPath, backupPath, serverName };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, configPath, backupPath: null, serverName, error: message };
    }
  }
}
