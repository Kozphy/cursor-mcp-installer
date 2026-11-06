import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSafeExecutable, spawnNoShell } from '../src/security/process.js';
import { resolveInside } from '../src/security/path-safety.js';
import { redactSecrets } from '../src/security/secret-redaction.js';
import { readPluginManifest } from '../src/plugins/manifest.js';
import { loadMarketplace } from '../src/plugins/marketplace.js';
import { installPlugin, uninstallPlugin, verifyPlugin } from '../src/plugins/installer.js';
import { installRepoDependencies } from '../src/install/git.js';
import { validateMcpServer, drainMessages } from '../src/validate/handshake.js';
import { request as httpRequest } from 'node:http';
import { startApiServer } from '../src/api/server.js';
import { createDashboardSession } from '../src/api/guard.js';
import { log } from '../src/utils/logging.js';
import type { Server } from 'node:http';

const marketplace = join(process.cwd(), 'tests', 'fixtures', 'marketplace', 'marketplace.json');

describe('process policy', () => {
  it('rejects shell metacharacters in executables', () => {
    expect(() => assertSafeExecutable('npm & calc.exe')).toThrow(/Rejected/);
    expect(() => assertSafeExecutable('..\\npm')).toThrow(/bare name/);
  });

  it('does not invoke a shell for injected arguments', async () => {
    const marker = join(tmpdir(), `should-not-exist-${Date.now()}`);
    await expect(spawnPromise('node', ['-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "x") & whoami`])).rejects.toThrow(/Rejected/);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('path safety', () => {
  it('rejects traversal and symlink escape', () => {
    const root = mkdtempSync(join(tmpdir(), 'root-'));
    mkdirSync(join(root, 'inside'));
    expect(() => resolveInside(root, '../outside')).toThrow(/escapes/);
    const outside = mkdtempSync(join(tmpdir(), 'out-'));
    try {
      symlinkSync(outside, join(root, 'link'), 'junction');
    } catch {
      symlinkSync(outside, join(root, 'link'), 'dir');
    }
    expect(() => resolveInside(root, 'link')).toThrow(/Symlink/);
  });
});

describe('untrusted lifecycle scripts', () => {
  it('does not run package scripts while staging dependencies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkg-'));
    const marker = join(dir, 'script-ran');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'evil',
      version: '1.0.0',
      scripts: { preinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"` },
    }));
    await installRepoDependencies(dir, false);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('plugin registry', () => {
  const home = mkdtempSync(join(tmpdir(), 'installer-home-'));

  beforeEach(() => {
    process.env.MCP_INSTALLER_HOME = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
  });

  it('rejects invalid manifests and duplicate marketplace entries', () => {
    const invalid = readPluginManifest(join(process.cwd(), 'tests', 'fixtures', 'invalid-plugin'));
    expect(invalid.manifest).toBeNull();
    expect(invalid.diagnostics.length).toBeGreaterThan(0);
    expect(() => loadMarketplace(join(process.cwd(), 'tests', 'fixtures', 'duplicate-marketplace.json'))).toThrow(/Duplicate/);
  });

  it('installs skills, rules, and blocks mcp or hooks without approval', async () => {
    const skills = await installPlugin('skills-only', { marketplacePath: marketplace, cursorVersion: '1.0.0' });
    expect(skills.ok).toBe(true);
    const again = await installPlugin('skills-only', { marketplacePath: marketplace, cursorVersion: '1.0.0' });
    expect(again.ok).toBe(true);
    expect(again.stages.some((stage) => stage.detail === 'already installed')).toBe(true);

    const rules = await installPlugin('rules-commands', { marketplacePath: marketplace, cursorVersion: '1.0.0' });
    expect(rules.ok).toBe(true);

    const mcp = await installPlugin('mcp-demo', { marketplacePath: marketplace, cursorVersion: '1.0.0' });
    expect(mcp.ok).toBe(false);
    expect(mcp.plan?.blockers.join(' ')).toMatch(/mcpServers/);

    const hooks = await installPlugin('hooked', { marketplacePath: marketplace, cursorVersion: '1.0.0' });
    expect(hooks.ok).toBe(false);
    expect(hooks.plan?.blockers.join(' ')).toMatch(/hooks/);

    const approved = await installPlugin('hooked', {
      marketplacePath: marketplace,
      cursorVersion: '1.0.0',
      approveHooks: true,
    });
    expect(approved.ok).toBe(true);
  });

  it('checks variables, client version, verify, and safe uninstall', async () => {
    const missing = await installPlugin('needs-var', { marketplacePath: marketplace, cursorVersion: '1.0.0' });
    expect(missing.ok).toBe(false);
    const present = await installPlugin('needs-var', {
      marketplacePath: marketplace,
      cursorVersion: '1.0.0',
      variables: { workspace: 'demo' },
    });
    expect(present.ok).toBe(true);

    const future = await installPlugin('future-cursor', { marketplacePath: marketplace, cursorVersion: '1.2.3' });
    expect(future.ok).toBe(false);

    const verified = await verifyPlugin('needs-var');
    expect(verified.ok).toBe(true);
    const owned = present.record?.files[0];
    expect(owned).toBeTruthy();
    writeFileSync(owned!.path, 'user edit');
    const removed = await uninstallPlugin('needs-var');
    expect(removed.kept).toContain(owned!.path);
    expect(readFileSync(owned!.path, 'utf8')).toBe('user edit');
  });
});

describe('handshake parsing', () => {
  it('splits content-length and newline messages', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 't', version: '1' } } });
    const buffer = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\n{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n`;
    const parsed = drainMessages(buffer);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.rest).toBe('');
  });

  it('fails when initialize returns a JSON-RPC error', async () => {
    const script = join(tmpdir(), `rpc-error-${Date.now()}.mjs`);
    writeFileSync(script, `process.stdin.on('data', () => { process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:1, error:{ code:-32000, message:'nope' } }) + '\\n'); });\n`);
    const result = await validateMcpServer('node', [script], undefined, 'rpc');
    expect(result.status).toBe('fail');
    expect(result.error).toMatch(/Initialize error/);
  });
});

describe('dashboard access control', () => {
  let server: Server;
  let port = 0;
  let token = '';

  beforeEach(async () => {
    process.env.MCP_INSTALLER_HOME = mkdtempSync(join(tmpdir(), 'dash-'));
    const session = createDashboardSession();
    token = session.token;
    server = await startApiServer(0, session, false);
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects unauthorized state changes and bad hosts', async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: `127.0.0.1:${port}` },
      body: JSON.stringify({ command: 'node', args: ['-e', 'process.exit(0)'] }),
    });
    expect(denied.status).toBe(401);

    const injected = await fetch(`http://127.0.0.1:${port}/api/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-installer-token': token,
        host: `127.0.0.1:${port}`,
      },
      body: JSON.stringify({ command: 'node & calc', args: [] }),
    });
    expect(injected.status).toBeGreaterThanOrEqual(400);

    const evilStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/system',
        method: 'GET',
        headers: { host: 'evil.example' },
      }, (res) => resolve(res.statusCode ?? 0));
      req.on('error', reject);
      req.end();
    });
    expect(evilStatus).toBe(403);
  });
});

describe('secret redaction', () => {
  it('removes credential fields from structured logs', () => {
    const line = JSON.stringify(redactSecrets({ token: 'super-secret', note: 'Bearer super-secret' }));
    expect(line).not.toContain('super-secret');
    let captured = '';
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => { captured += chunk; return true; }) as typeof process.stderr.write;
    log.error('auth', { api_key: 'abcd1234' });
    process.stderr.write = original;
    expect(captured).not.toContain('abcd1234');
  });
});

function spawnPromise(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawnNoShell(command, args);
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
    } catch (err) {
      reject(err);
    }
  });
}
