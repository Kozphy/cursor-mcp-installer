import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { log } from '../utils/logging.js';
import { hostAllowed, tokenAuthorized } from './guard.js';
import { redactSecrets } from '../security/secret-redaction.js';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';

interface WsClient {
  socket: Duplex;
  id: string;
}

export class WebSocketManager {
  private clients: WsClient[] = [];

  constructor(private readonly sessionToken: string, private readonly binding: { port: number }) {}

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, _head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws' || !hostAllowed(req.headers.host, this.binding.port)) {
      socket.destroy();
      return;
    }
    const fake = { headers: { ...req.headers, 'x-installer-token': url.searchParams.get('token') ?? '' } } as unknown as IncomingMessage;
    if (!tokenAuthorized(fake, this.sessionToken)) {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC11E5B0')
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n');

    socket.write(headers);

    const clientId = crypto.randomUUID();
    const client: WsClient = { socket, id: clientId };
    this.clients.push(client);
    log.debug('WebSocket client connected', { id: clientId });

    socket.on('close', () => {
      this.clients = this.clients.filter(c => c.id !== clientId);
      log.debug('WebSocket client disconnected', { id: clientId });
    });

    socket.on('error', () => {
      this.clients = this.clients.filter(c => c.id !== clientId);
    });
  }

  broadcast(data: unknown): void {
    const payload = JSON.stringify(redactSecrets(data));
    const frame = this.encodeFrame(payload);

    for (const client of this.clients) {
      try {
        client.socket.write(frame);
      } catch {
        // client disconnected
      }
    }
  }

  private encodeFrame(payload: string): Buffer {
    const data = Buffer.from(payload, 'utf-8');
    const length = data.length;

    let header: Buffer;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    return Buffer.concat([header, data]);
  }
}
