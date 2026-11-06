import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const SHELL_META = /[\0\r\n|&;<>^`$]/;
const SAFE_BODY = /^[A-Za-z0-9._@+:/=#?,'"()[\]\\-]+$/;
const WINDOWS_SHIMS = new Set(['uvx', 'claude', 'python', 'python3', 'py']);
const DENIED_EXECUTABLES = new Set(['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'bash', 'sh', 'wscript', 'cscript']);

export function assertSafeExecutable(command: string): void {
  if (typeof command !== 'string' || command.trim() === '' || command !== command.trim()) {
    throw new Error('Rejected executable: empty or padded name');
  }
  if (command.includes('..') || command.includes('/') || command.includes('\\') || command.includes(' ')) {
    throw new Error(`Rejected executable: bare name required, got ${command}`);
  }
  const base = command.toLowerCase();
  if (DENIED_EXECUTABLES.has(base) || SHELL_META.test(command) || !SAFE_BODY.test(command)) {
    throw new Error(`Rejected executable: ${command}`);
  }
}

export function assertSafeArg(arg: string): void {
  if (typeof arg !== 'string' || arg.length === 0 || SHELL_META.test(arg)) {
    throw new Error('Rejected unsafe process argument');
  }
  const body = arg.replace(/^-+/, '');
  if (!body || !SAFE_BODY.test(body)) {
    throw new Error('Rejected unsafe process argument');
  }
}

export interface NoShellSpawnOptions extends SpawnOptions {
  timeoutMs?: number;
}

export function spawnNoShell(command: string, args: string[], options: NoShellSpawnOptions = {}): ChildProcess {
  assertSafeExecutable(command);
  for (const arg of args) assertSafeArg(arg);

  const { timeoutMs, ...spawnOptions } = options;
  const resolved = resolveSpawn(command, args);
  const child = spawn(resolved.file, resolved.argv, {
    ...spawnOptions,
    shell: false,
    windowsHide: true,
  });

  if (timeoutMs && timeoutMs > 0) {
    const timer = setTimeout(() => killProcessTree(child), timeoutMs);
    child.on('exit', () => clearTimeout(timer));
  }
  return child;
}

function resolveSpawn(command: string, args: string[]): { file: string; argv: string[] } {
  if (process.platform === 'win32' && (command === 'npm' || command === 'npx')) {
    const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', `${command}-cli.js`);
    if (existsSync(cli)) return { file: process.execPath, argv: [cli, ...args] };
  }
  if (process.platform === 'win32' && command === 'git') {
    const git = findWindowsExe('git');
    if (git) return { file: git, argv: args };
  }
  if (process.platform === 'win32' && command === 'node') {
    return { file: process.execPath, argv: args };
  }
  if (process.platform === 'win32' && WINDOWS_SHIMS.has(command)) {
    return { file: process.env.ComSpec ?? 'cmd.exe', argv: ['/d', '/s', '/c', command, ...args] };
  }
  return { file: command, argv: args };
}

function findWindowsExe(command: string): string | null {
  try {
    const output = execFileSync('where.exe', [command], { shell: false, encoding: 'utf8' });
    const exe = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.toLowerCase().endsWith('.exe'));
    return exe ?? null;
  } catch {
    return null;
  }
}

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true });
    return;
  }
  try {
    process.kill(child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGKILL');
  }
}

export function execNoShell(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child: ChildProcess;
    try {
      child = spawnNoShell(command, args, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeout,
      });
    } catch (err) {
      reject(err);
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited ${code}`));
    });
  });
}
