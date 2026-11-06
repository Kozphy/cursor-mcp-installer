import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveInside(root: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new Error('Path escapes root: NUL in path');
  }
  const rootReal = fs.realpathSync(root);
  const target = path.resolve(rootReal, relativePath);
  const relative = path.relative(rootReal, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${relativePath}`);
  }
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const fromRoot = path.relative(rootReal, real);
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
      throw new Error(`Symlink escapes root: ${relativePath}`);
    }
    return real;
  }
  return target;
}

export function assertUrlHasNoCredentials(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Rejected source URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error('Rejected source URL: only https is allowed');
  }
  if (url.username || url.password) {
    throw new Error('Rejected source URL: credentials are not allowed');
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'github.com' || host === 'gitlab.com' || host === 'bitbucket.org';
  if (!allowed) {
    throw new Error(`Rejected source URL host: ${host}`);
  }
  return url;
}

export function parsePinnedGitUrl(input: string): { cloneUrl: string; commit: string } {
  const [base, commit] = input.split('#');
  const url = assertUrlHasNoCredentials(base);
  if (!commit || !/^[a-f0-9]{40}$/i.test(commit)) {
    throw new Error('Rejected source URL: remote git sources must be pinned to a 40-character commit SHA');
  }
  return { cloneUrl: url.toString(), commit };
}
