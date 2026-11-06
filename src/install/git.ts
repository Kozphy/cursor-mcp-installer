import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpServerEntry } from '../clients/types.js';
import { createError } from '../utils/errors.js';
import { log } from '../utils/logging.js';
import { execNoShell } from '../security/process.js';
import { parsePinnedGitUrl } from '../security/path-safety.js';

export async function installRepoDependencies(tempDir: string, allowScripts = false): Promise<void> {
  if (!fs.existsSync(path.join(tempDir, 'package.json'))) return;
  const npmArgs = allowScripts
    ? ['install', '--omit=dev']
    : ['install', '--omit=dev', '--ignore-scripts'];
  log.info('Installing repository dependencies', { scripts: allowScripts });
  await execNoShell('npm', npmArgs, { cwd: tempDir, timeout: 120000 });
}

export function isGitUrl(name: string): boolean {
  return name.endsWith('.git') || name.includes('github.com') || name.includes('gitlab.com') || name.includes('bitbucket.org');
}

export async function resolveGitRepo(
  url: string,
  args?: string[],
  env?: Record<string, string>,
  options: { allowScripts?: boolean } = {},
): Promise<{ entry: McpServerEntry; name: string }> {
  const pinned = parsePinnedGitUrl(url);
  const repoName = pinned.cloneUrl.split('/').pop()?.replace('.git', '') ?? 'mcp-repo';
  const tempDir = path.join(os.tmpdir(), `mcp-${repoName}-${Date.now()}`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    log.info('Cloning pinned repository', { host: new URL(pinned.cloneUrl).host });
    await execNoShell('git', ['init', tempDir], { timeout: 15000 });
    await execNoShell('git', ['remote', 'add', 'origin', pinned.cloneUrl], { cwd: tempDir, timeout: 15000 });
    await execNoShell('git', ['fetch', '--depth', '1', 'origin', pinned.commit], { cwd: tempDir, timeout: 60000 });
    await execNoShell('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: tempDir, timeout: 15000 });
  } catch (err) {
    throw createError('GIT_CLONE_FAILED', err instanceof Error ? err.message : String(err));
  }

  await installRepoDependencies(tempDir, options.allowScripts === true);

  const entryFile = ['index.mjs', 'index.js', 'src/index.mjs', 'src/index.js', 'dist/index.js']
    .find(f => fs.existsSync(path.join(tempDir, f)));

  if (!entryFile) {
    if (fs.existsSync(path.join(tempDir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json'), 'utf-8'));
      const main = pkg.main ?? pkg.bin?.[Object.keys(pkg.bin ?? {})[0]];
      if (main) {
        return {
          name: repoName,
          entry: {
            command: 'node',
            args: [path.join(tempDir, main), ...(args ?? [])],
            env,
            type: 'stdio',
          },
        };
      }
    }
    throw createError('PATH_NOT_FOUND', `No entry point found in cloned repository: ${tempDir}`);
  }

  return {
    name: repoName,
    entry: {
      command: 'node',
      args: [path.join(tempDir, entryFile), ...(args ?? [])],
      env,
      type: 'stdio',
    },
  };
}
