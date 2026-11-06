import * as http from 'node:http';
import { detectOs } from '../detect/os.js';
import { detectRuntimes } from '../detect/runtimes.js';
import { detectClients } from '../detect/clients.js';
import { resolveNpmPackage, isNpmPackage, formatServerName } from '../install/npm.js';
import { resolveUvxPackage } from '../install/uvx.js';
import { isGitUrl, resolveGitRepo } from '../install/git.js';
import { resolveLocalPath } from '../install/local.js';
import { CursorWriter } from '../clients/cursor.js';
import { ClaudeDesktopWriter } from '../clients/claude-desktop.js';
import { VSCodeWriter } from '../clients/vscode.js';
import { OpenClawWriter } from '../clients/openclaw.js';
import { ClaudeCodeWriter } from '../clients/claude-code.js';
import { ChatGPTBridgeWriter } from '../clients/chatgpt-bridge.js';
import { validateMcpServer } from '../validate/handshake.js';
import { generateReport } from '../validate/health-report.js';
import { WebSocketManager } from './websocket.js';
import { ClientWriter, McpServerEntry } from '../clients/types.js';
import { z } from 'zod';
import { log } from '../utils/logging.js';
import { MAX_BODY_BYTES, tokenAuthorized, type DashboardSession } from './guard.js';
import { assertSafeArg, assertSafeExecutable } from '../security/process.js';

const allWriters: ClientWriter[] = [
  new CursorWriter(),
  new ClaudeDesktopWriter(),
  new VSCodeWriter(),
  new OpenClawWriter(),
  new ClaudeCodeWriter(),
  new ChatGPTBridgeWriter(),
];

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const installBody = z.object({
  package: z.string().min(1).max(500),
  method: z.enum(['auto', 'npm', 'uvx', 'git', 'local']).optional(),
  clients: z.array(z.string().max(64)).max(20).optional(),
  env: z.record(z.string().max(200), z.string().max(2000)).optional(),
  args: z.array(z.string().max(500)).max(50).optional(),
});

const validateBody = z.object({
  command: z.string().min(1).max(200),
  args: z.array(z.string().max(500)).max(50).optional(),
  env: z.record(z.string().max(200), z.string().max(2000)).optional(),
});

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handleApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ws: WebSocketManager,
  session: DashboardSession,
): Promise<void> {
  const url = req.url ?? '';

  try {
    if (req.method === 'POST' && !tokenAuthorized(req, session.token)) {
      jsonResponse(res, { error: 'unauthorized' }, 401);
      return;
    }
    if (url === '/api/system' && req.method === 'GET') {
      const osInfo = detectOs();
      const runtimes = await detectRuntimes();
      const clients = detectClients();
      jsonResponse(res, { os: osInfo, runtimes, clients });
      return;
    }

    if (url === '/api/clients' && req.method === 'GET') {
      const clients = detectClients();
      jsonResponse(res, { clients });
      return;
    }

    if (url === '/api/install' && req.method === 'POST') {
      const parsed = installBody.safeParse(JSON.parse(await readBody(req)));
      if (!parsed.success) {
        jsonResponse(res, { error: 'invalid install request' }, 400);
        return;
      }
      const body = parsed.data;
      const pkgName = body.package;
      const method = body.method ?? 'auto';
      const clientIds = body.clients ?? [];
      const envEntries = body.env ?? {};
      const serverArgs = body.args ?? [];
      assertSafeArg(pkgName);
      for (const arg of serverArgs) assertSafeArg(arg);

      ws.broadcast({ type: 'install_step', data: { step: 'Resolving package', status: 'running' } });

      let entry: McpServerEntry;
      let displayName: string;

      if (method === 'local' || pkgName.startsWith('/')) {
        const result = await resolveLocalPath(pkgName, serverArgs, envEntries);
        entry = result.entries[0].entry;
        displayName = formatServerName(result.entries[0].name);
      } else if (method === 'git' || (method === 'auto' && isGitUrl(pkgName))) {
        const result = await resolveGitRepo(pkgName, serverArgs, envEntries);
        entry = result.entry;
        displayName = formatServerName(result.name);
      } else if (method === 'uvx') {
        entry = resolveUvxPackage(pkgName, serverArgs, envEntries);
        displayName = formatServerName(pkgName);
      } else {
        if (method === 'auto' && !(await isNpmPackage(pkgName))) {
          entry = resolveUvxPackage(pkgName, serverArgs, envEntries);
        } else {
          entry = await resolveNpmPackage(pkgName, serverArgs, envEntries);
        }
        displayName = formatServerName(pkgName);
      }

      ws.broadcast({ type: 'install_step', data: { step: 'Resolving package', status: 'done' } });
      ws.broadcast({ type: 'install_step', data: { step: 'Writing config', status: 'running' } });

      const targetWriters = clientIds.length > 0
        ? allWriters.filter(w => clientIds.includes(w.id))
        : allWriters.filter(w => w.detect().installed);

      const writeResults = targetWriters.map(w => {
        const r = w.write(displayName, entry);
        ws.broadcast({
          type: 'validation_result',
          data: { client: w.name, status: r.success ? 'pass' : 'fail', error: r.error },
        });
        return r;
      });

      ws.broadcast({ type: 'install_step', data: { step: 'Writing config', status: 'done' } });
      ws.broadcast({ type: 'install_step', data: { step: 'Validating', status: 'running' } });

      const osInfo = detectOs();
      const runtimes = await detectRuntimes();

      let validation: Awaited<ReturnType<typeof validateMcpServer>> | null = null;
      if (entry.command) {
        validation = await validateMcpServer(entry.command, entry.args ?? [], entry.env);
      }

      const results = targetWriters.map(w => ({
        ...(validation ?? { client: w.name, status: 'skip' as const, latencyMs: 0 }),
        client: w.name,
      }));

      const report = generateReport(displayName, osInfo, runtimes, results);
      ws.broadcast({ type: 'install_step', data: { step: 'Validating', status: 'done' } });
      ws.broadcast({ type: 'report_complete', data: report });

      jsonResponse(res, { success: true, report, writeResults });
      return;
    }

    if (url === '/api/validate' && req.method === 'POST') {
      const parsed = validateBody.safeParse(JSON.parse(await readBody(req)));
      if (!parsed.success) {
        jsonResponse(res, { error: 'invalid validate request' }, 400);
        return;
      }
      const command = parsed.data.command;
      const args = parsed.data.args ?? [];
      const env = parsed.data.env ?? {};
      assertSafeExecutable(command);
      for (const arg of args) assertSafeArg(arg);

      const result = await validateMcpServer(command, args, env, 'API Test');
      jsonResponse(res, result);
      return;
    }

    jsonResponse(res, { error: 'Not found' }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('API error', { url, error: message });
    jsonResponse(res, { error: message }, 500);
  }
}
