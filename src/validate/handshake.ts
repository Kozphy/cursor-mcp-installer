import type { ChildProcess } from 'node:child_process';
import { log } from '../utils/logging.js';
import { ValidationResult } from '../clients/types.js';
import { killProcessTree, spawnNoShell } from '../security/process.js';
import { redactSecrets } from '../security/secret-redaction.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

const HANDSHAKE_TIMEOUT = 20000;
const MAX_STDOUT = 1_000_000;
const MAX_STDERR = 64_000;

export async function validateMcpServer(
  command: string,
  args: string[],
  env?: Record<string, string>,
  clientName?: string,
): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = clientName ?? 'unknown';

  return new Promise<ValidationResult>((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnNoShell(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
    } catch (err) {
      resolve(fail(client, startTime, err instanceof Error ? err.message : String(err), 'Command rejected by process policy.'));
      return;
    }

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let initDone = false;

    const finish = (result: ValidationResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      killProcessTree(proc);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(fail(client, startTime, `Handshake timeout (${HANDSHAKE_TIMEOUT}ms)`, 'Server did not complete initialize and tools/list.'));
    }, HANDSHAKE_TIMEOUT);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_STDOUT) {
        finish(fail(client, startTime, 'stdout exceeded buffer limit'));
        return;
      }
      try {
        const parsed = drainMessages(stdout);
        stdout = parsed.rest;
        for (const msg of parsed.messages) handleMessage(msg);
      } catch (err) {
        finish(fail(client, startTime, err instanceof Error ? err.message : String(err)));
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
    });

    proc.on('error', (err) => {
      finish(fail(client, startTime, `Failed to spawn: ${err.message}`, `Check that "${command}" exists and is executable.`));
    });

    proc.on('close', (code) => {
      finish(fail(
        client,
        startTime,
        `Server exited with code ${code} before handshake completed`,
        stderr ? `Server stderr: ${stderr.slice(0, 200)}` : 'No stderr output from server.',
      ));
    });

    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: { roots: { listChanged: true } },
        clientInfo: { name: 'universal-mcp-installer', version: '1.0.0' },
      },
    };
    proc.stdin?.write(JSON.stringify(initRequest) + '\n');

    function handleMessage(msg: JsonRpcMessage) {
      if (msg.jsonrpc && msg.jsonrpc !== '2.0') {
        finish(fail(client, startTime, `Invalid jsonrpc version: ${msg.jsonrpc}`));
        return;
      }
      if (msg.id === 1 && !initDone) {
        if (msg.error) {
          finish(fail(client, startTime, `Initialize error: ${msg.error.message ?? 'unknown'}`, 'Server rejected initialization.'));
          return;
        }
        if (!msg.result || typeof msg.result !== 'object') {
          finish(fail(client, startTime, 'Initialize response missing result'));
          return;
        }
        const result = msg.result as Record<string, unknown>;
        if (typeof result.protocolVersion !== 'string' || !result.serverInfo) {
          finish(fail(client, startTime, 'Initialize result missing protocolVersion or serverInfo'));
          return;
        }
        initDone = true;
        log.debug('Initialize response received', redactSecrets({ result }) as Record<string, unknown>);
        proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        const listToolsReq: JsonRpcRequest = {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        };
        proc.stdin?.write(JSON.stringify(listToolsReq) + '\n');
        return;
      }

      if (msg.id === 2 && initDone) {
        if (msg.error) {
          finish(fail(client, startTime, `tools/list error: ${msg.error.message ?? 'unknown'}`));
          return;
        }
        const result = msg.result as { tools?: unknown } | undefined;
        if (!result || !Array.isArray(result.tools)) {
          finish(fail(client, startTime, 'tools/list result.tools is not an array'));
          return;
        }
        finish({
          client,
          status: 'pass',
          toolCount: result.tools.length,
          latencyMs: Date.now() - startTime,
        });
      }
    }
  });
}

export function drainMessages(buffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const messages: JsonRpcMessage[] = [];
  let rest = buffer;
  while (rest.length > 0) {
    if (rest.startsWith('Content-Length:')) {
      const headerEnd = rest.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const match = /Content-Length:\s*(\d+)/i.exec(rest.slice(0, headerEnd));
      if (!match) throw new Error('Invalid Content-Length header');
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (rest.length < start + length) break;
      messages.push(JSON.parse(rest.slice(start, start + length)) as JsonRpcMessage);
      rest = rest.slice(start + length);
      continue;
    }
    const newline = rest.indexOf('\n');
    if (newline < 0) break;
    const line = rest.slice(0, newline).trim();
    rest = rest.slice(newline + 1);
    if (!line) continue;
    messages.push(JSON.parse(line) as JsonRpcMessage);
  }
  return { messages, rest };
}

function fail(client: string, startTime: number, error: string, hint?: string): ValidationResult {
  return {
    client,
    status: 'fail',
    latencyMs: Date.now() - startTime,
    error,
    hint,
  };
}
