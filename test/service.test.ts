import { afterEach, describe, expect, test } from 'bun:test';
import type { BrowseRelay } from '../src/service/browseRelay.ts';
import { createBridgeServer } from '../src/service/main.ts';

const servers: ReturnType<typeof createBridgeServer>[] = [];

async function startServer(relay: BrowseRelay, token = 'test-token'): Promise<string> {
  const server = createBridgeServer({ relay, token });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No server address');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function fakeRelay(value: unknown): BrowseRelay {
  return {
    execute: async () => ({
      text: '',
      isError: false,
      value,
      session: { id: 'oc-ses_1' },
    }),
    targets: async () => [],
  } as unknown as BrowseRelay;
}

describe('browse bridge service', () => {
  test('answers health without a body', async () => {
    const base = await startServer(fakeRelay({ ok: true, data: {} }));
    const response = await fetch(`${base}/health`, { headers: { authorization: 'Bearer test-token' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test('refuses a request without the host token', async () => {
    const base = await startServer(fakeRelay({ ok: true, data: {} }));
    const response = await fetch(`${base}/browser-control`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
  });

  test('answers a browser action in the host wire shape', async () => {
    const base = await startServer(fakeRelay({
      ok: true,
      data: {
        url: 'https://example.com',
        title: 'Example',
        scope: 'document',
        scrollY: 0,
        maxScrollY: 0,
        text: 'Hello',
        elements: [],
        viewport: { mode: 'fill', width: null, height: null },
      },
    }));

    const response = await fetch(`${base}/browser-control`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'request-1',
        action: 'browser.snapshot',
        parameters: {},
        context: { directory: null, sessionId: 'ses_1' },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        url: 'https://example.com',
        title: 'Example',
        scope: 'document',
        scrollY: 0,
        maxScrollY: 0,
        text: 'Hello',
        elements: [],
        viewport: { mode: 'fill', width: null, height: null },
        tabs: [],
      },
    });
  });

  test('answers an action failure with HTTP 200 so the agent sees the message', async () => {
    const base = await startServer(fakeRelay({ ok: false, error: 'No element matches #save' }));

    const response = await fetch(`${base}/browser-control`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: 'request-1',
        action: 'browser.click',
        parameters: { selector: '#save' },
        context: { directory: null, sessionId: 'ses_1' },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, error: 'No element matches #save' });
  });

  test('refuses a body that is not a browser action', async () => {
    const base = await startServer(fakeRelay({ ok: true, data: {} }));
    const response = await fetch(`${base}/browser-control`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'browser.nope' }),
    });
    expect(response.status).toBe(400);
  });
});
