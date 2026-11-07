import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_PROVIDER_PATH, readBrowserProviderRequest } from '@openchamber/sdk';
import { handleBrowserAction } from './actions.ts';
import { BrowseRelay } from './browseRelay.ts';
import { readBridgeConfig } from './config.ts';

const extensionRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error('Request body is too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

/**
 * The service loopback the host posts `browser.*` actions to. Every action
 * failure is an HTTP 200 with `{ ok: false, error }`, because the host reads a
 * non-200 as "unknown page state" and loses the message the agent needs.
 */
export function createBridgeServer(options: { relay: BrowseRelay; token: string }): http.Server {
  return http.createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      sendJson(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === BROWSER_PROVIDER_PATH && request.method === 'POST') {
      let body: string;
      try {
        body = await readBody(request);
      } catch {
        sendJson(response, 400, { ok: false, error: 'Request body is too large' });
        return;
      }
      const action = readBrowserProviderRequest(body);
      if (!action) {
        sendJson(response, 400, { ok: false, error: 'Not a browser action' });
        return;
      }
      const result = await handleBrowserAction(action, { relay: options.relay });
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { ok: false, error: 'not-found' });
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
  const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
  if (!port || !token) {
    console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
    process.exit(1);
  }

  const config = readBridgeConfig(extensionRoot);
  const relay = new BrowseRelay(config);
  const server = createBridgeServer({ relay, token });
  server.listen(port, '127.0.0.1', () => {
    console.log(`browse bridge listening on 127.0.0.1:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
