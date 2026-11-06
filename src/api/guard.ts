import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

export interface DashboardSession {
  token: string;
  tokenPath: string;
}

export function createDashboardSession(): DashboardSession {
  const token = randomBytes(32).toString('hex');
  const dir = process.env.MCP_INSTALLER_HOME ?? join(homedir(), '.universal-mcp-installer');
  mkdirSync(dir, { recursive: true });
  const tokenPath = join(dir, 'dashboard.token');
  writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return { token, tokenPath };
}

export function hostAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function tokenAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers['x-installer-token'];
  const authorization = req.headers.authorization;
  const presented = typeof header === 'string'
    ? header
    : authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
  const left = Buffer.from(presented);
  const right = Buffer.from(token);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const MAX_BODY_BYTES = 64 * 1024;
