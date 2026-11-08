import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { BrowseRelay, relayTokenPath } from '../src/service/browseRelay.ts';

const servers: http.Server[] = [];
const homes: string[] = [];

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-bridge-'));
  homes.push(home);
  return home;
}

async function startRelay(handler: (request: http.IncomingMessage, response: http.ServerResponse) => void): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No server address');
  return address.port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

describe('BrowseRelay', () => {
  test('sends the token and the execute body to the relay', async () => {
    let seenAuthorization: string | undefined;
    let seenBody: unknown;
    const port = await startRelay((request, response) => {
      if (request.url === '/version') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ version: 'test' }));
        return;
      }
      if (request.url === '/cli/execute') {
        seenAuthorization = request.headers.authorization;
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
          seenBody = JSON.parse(body);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({
            text: '',
            isError: false,
            value: { ok: true, data: { url: 'https://example.com' } },
            session: { id: 'oc-ses_1' },
          }));
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });

    const home = tempHome();
    fs.writeFileSync(relayTokenPath({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false }), 'test-token\n', { mode: 0o600 });
    const relay = new BrowseRelay({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false });

    const result = await relay.execute('return 1', { sessionId: 'oc-ses_1', timeoutMs: 1_000 });

    expect(result.isError).toBe(false);
    expect(result.value).toEqual({ ok: true, data: { url: 'https://example.com' } });
    expect(seenAuthorization).toBe('Bearer test-token');
    expect(seenBody).toEqual({
      sessionId: 'oc-ses_1',
      code: 'return 1',
      createIfMissing: true,
      timeoutMs: 1_000,
    });
  });

  test('reads the tab list', async () => {
    const port = await startRelay((request, response) => {
      if (request.url === '/version') {
        response.writeHead(200);
        response.end('{}');
        return;
      }
      if (request.url === '/json/list') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify([{ id: 'T1', title: 'A', url: 'https://a', opencodeBrowserSessionId: 'oc-ses_1' }]));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    const home = tempHome();
    fs.writeFileSync(relayTokenPath({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false }), 'test-token\n', { mode: 0o600 });
    const relay = new BrowseRelay({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false });

    expect(await relay.targets()).toEqual([
      { id: 'T1', title: 'A', url: 'https://a', opencodeBrowserSessionId: 'oc-ses_1' },
    ]);
  });

  test('explains a missing token', async () => {
    const port = await startRelay((request, response) => {
      response.writeHead(200);
      response.end('{}');
    });
    const home = tempHome();
    const relay = new BrowseRelay({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false });

    await expect(relay.execute('return 1', { sessionId: 'oc-ses_1', timeoutMs: 1_000 }))
      .rejects.toThrow('relay token is missing');
  });

  test('does not start a relay that is not running when startRelay is false', async () => {
    const home = tempHome();
    const relay = new BrowseRelay({ browseBin: 'browse', relayPort: 1, browseHome: home, startRelay: false });

    await expect(relay.execute('return 1', { sessionId: 'oc-ses_1', timeoutMs: 1_000 }))
      .rejects.toThrow('not reachable');
  });

  test('stops at the caller deadline instead of waiting for the relay timeout', async () => {
    const port = await startRelay((request, response) => {
      if (request.url === '/version') {
        response.writeHead(200);
        response.end('{}');
        return;
      }
      if (request.url === '/cli/execute') {
        const timer = setTimeout(() => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({
            text: '',
            isError: false,
            value: { ok: true, data: {} },
            session: { id: 'oc-ses_1' },
          }));
        }, 5_000);
        request.on('close', () => clearTimeout(timer));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    const home = tempHome();
    fs.writeFileSync(relayTokenPath({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false }), 'test-token\n');
    const relay = new BrowseRelay({ browseBin: 'browse', relayPort: port, browseHome: home, startRelay: false });

    const start = Date.now();
    await expect(relay.execute('return 1', {
      sessionId: 'oc-ses_1',
      timeoutMs: 5_000,
      deadline: Date.now() + 500,
    })).rejects.toThrow('did not answer within the time limit');
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});
