import { describe, expect, test } from 'bun:test';
import type { BrowserProviderRequest } from '@openchamber/sdk';
import { BridgeState, handleBrowserAction } from '../src/service/actions.ts';
import type { BrowserActionDeps } from '../src/service/actions.ts';
import type { BrowseRelay, RelayExecuteResult, RelayTarget } from '../src/service/browseRelay.ts';

type FakeOptions = {
  targets?: RelayTarget[];
  result?: RelayExecuteResult;
  onExecute?: (code: string, options: { sessionId: string; timeoutMs: number }) => void;
};

function fakeRelay(options: FakeOptions = {}): BrowseRelay {
  return {
    execute: async (code: string, executeOptions: { sessionId: string; timeoutMs: number }) => {
      options.onExecute?.(code, executeOptions);
      return options.result ?? {
        text: '',
        isError: false,
        value: { ok: true, data: {} },
        session: { id: executeOptions.sessionId },
      };
    },
    targets: async () => options.targets ?? [],
  } as unknown as BrowseRelay;
}

function request(
  action: BrowserProviderRequest['action'],
  parameters: Record<string, unknown>,
  sessionId: string | null = 'ses_1',
): BrowserProviderRequest {
  return {
    requestId: 'request-1',
    action,
    parameters,
    context: { directory: null, sessionId },
  } as BrowserProviderRequest;
}

function deps(relay: BrowseRelay, state = new BridgeState()): BrowserActionDeps {
  return { relay, state };
}

function result(data: unknown): RelayExecuteResult {
  return {
    text: '',
    isError: false,
    value: { ok: true, data },
    session: { id: 'oc-ses_1' },
  };
}

const ownTab: RelayTarget = {
  id: 'T1',
  title: 'Example',
  url: 'https://example.com',
  opencodeBrowserSessionId: 'oc-ses_1',
};

describe('BridgeState session ids', () => {
  test('keeps the OpenChamber session id inside browse rules', () => {
    const state = new BridgeState();
    expect(state.sessionId('ses_ABC-123', null)).toBe('oc-ses_abc-123');
    expect(state.sessionId('!!!', null)).toBe('oc-default');
  });

  test('gives an unscoped caller a directory bucket or its own random bucket', () => {
    const state = new BridgeState();
    expect(state.sessionId(null, '/home/me/app')).toMatch(/^oc-dir-[0-9a-f]{16}$/);
    expect(state.sessionId(null, null)).toMatch(/^oc-unscoped-[0-9a-f]{8}$/);
    expect(state.sessionId(null, null)).toBe(state.sessionId(null, null));
  });
});

describe('handleBrowserAction', () => {
  test('opens a tab and returns its id', async () => {
    const data = {
      tabId: 'T1',
      url: 'https://example.com',
      title: 'Example',
      opened: true,
      settled: true,
      viewport: { mode: 'fill', width: null, height: null },
    };
    let code = '';
    const relay = fakeRelay({ result: result(data), onExecute: (value) => { code = value; } });

    const answer = await handleBrowserAction(
      request('browser.open', { url: 'https://example.com' }),
      deps(relay),
    );

    expect(answer).toEqual({ ok: true, data });
    expect(code).toContain('https://example.com');
    expect(code).toContain('context.newPage()');
  });

  test('navigates an existing tab when tabId is given', async () => {
    const data = {
      tabId: 'T1',
      url: 'https://example.com/next',
      title: 'Next',
      opened: true,
      settled: true,
      viewport: { mode: 'fill', width: null, height: null },
    };
    let code = '';
    const relay = fakeRelay({ targets: [ownTab], result: result(data), onExecute: (value) => { code = value; } });

    const answer = await handleBrowserAction(
      request('browser.open', { url: 'https://example.com/next', tabId: 'T1' }),
      deps(relay),
    );

    expect(answer).toEqual({ ok: true, data });
    expect(code).toContain('__oc.select("T1")');
    expect(code).not.toContain('context.newPage()');
  });

  test('refuses a tab that belongs to another session', async () => {
    const relay = fakeRelay({
      targets: [{ ...ownTab, opencodeBrowserSessionId: 'oc-other' }],
    });

    const answer = await handleBrowserAction(
      request('browser.click', { tabId: 'T1', selector: '#save' }),
      deps(relay),
    );

    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toContain('No tab T1');
  });

  test('merges the session tabs into a snapshot and removes the internal active id', async () => {
    const snapshot = {
      url: 'https://example.com',
      title: 'Example',
      scope: 'document',
      scrollY: 0,
      maxScrollY: 0,
      text: 'Hello',
      elements: [],
      viewport: { mode: 'fill', width: null, height: null },
      activeTabId: 'T1',
    };
    const relay = fakeRelay({ targets: [{ ...ownTab, title: 'https://example.com' }], result: result(snapshot) });

    const answer = await handleBrowserAction(request('browser.snapshot', {}), deps(relay));

    expect(answer).toEqual({
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
        tabs: [{ id: 'T1', title: 'Example', url: 'https://example.com', active: true }],
      },
    });
  });

  test('closing a background tab keeps the last-used tab', async () => {
    const state = new BridgeState();
    const openOne = fakeRelay({
      result: result({
        tabId: 'T1',
        url: 'https://example.com',
        title: 'One',
        opened: true,
        settled: true,
        viewport: { mode: 'fill', width: null, height: null },
      }),
    });
    await handleBrowserAction(request('browser.open', { url: 'https://example.com' }), deps(openOne, state));

    const openTwo = fakeRelay({
      result: result({
        tabId: 'T2',
        url: 'https://example.com/two',
        title: 'Two',
        opened: true,
        settled: true,
        viewport: { mode: 'fill', width: null, height: null },
      }),
    });
    await handleBrowserAction(request('browser.open', { url: 'https://example.com/two' }), deps(openTwo, state));

    const closeRelay = fakeRelay({
      targets: [ownTab, { ...ownTab, id: 'T2', title: 'Two', url: 'https://example.com/two' }],
      result: result({ closed: true, tabId: 'T1' }),
    });
    await handleBrowserAction(request('browser.close', { tabId: 'T1' }), deps(closeRelay, state));

    expect(state.lastTabId(state.sessionId('ses_1', null))).toBe('T2');
  });

  test('closes the most recent tab when tabId is omitted', async () => {
    const second: RelayTarget = {
      id: 'T2',
      title: 'Second',
      url: 'https://example.com/second',
      opencodeBrowserSessionId: 'oc-ses_1',
    };
    let code = '';
    const relay = fakeRelay({
      targets: [ownTab, second],
      result: result({ closed: true, tabId: 'T2' }),
      onExecute: (value) => { code = value; },
    });

    const answer = await handleBrowserAction(request('browser.close', {}), deps(relay));

    expect(answer).toEqual({ ok: true, data: { closed: true, tabId: 'T2' } });
    expect(code).toContain('__oc.select("T2")');
  });

  test('maps a page script result for click', async () => {
    const relay = fakeRelay({
      targets: [ownTab],
      result: result({ clicked: '#save', label: 'Save', url: 'https://example.com' }),
    });

    const answer = await handleBrowserAction(
      request('browser.click', { tabId: 'T1', selector: '#save' }),
      deps(relay),
    );

    expect(answer).toEqual({
      ok: true,
      data: { clicked: '#save', label: 'Save', url: 'https://example.com' },
    });
  });

  test('turns a relay error into the agent-visible error', async () => {
    const relay = fakeRelay({
      result: {
        text: 'No element matches #save',
        isError: true,
        session: { id: 'oc-ses_1' },
      },
    });

    const answer = await handleBrowserAction(
      request('browser.click', { selector: '#save' }),
      deps(relay),
    );

    expect(answer).toEqual({ ok: false, error: 'No element matches #save' });
  });

  test('forgets a remembered tab that is gone and falls back to the session page', async () => {
    const state = new BridgeState();
    const openRelay = fakeRelay({
      result: result({
        tabId: 'T1',
        url: 'https://example.com',
        title: 'Example',
        opened: true,
        settled: true,
        viewport: { mode: 'fill', width: null, height: null },
      }),
    });
    await handleBrowserAction(request('browser.open', { url: 'https://example.com' }), deps(openRelay, state));

    let code = '';
    const clickRelay = fakeRelay({
      targets: [],
      result: result({ clicked: '#save', label: 'Save', url: 'https://example.com' }),
      onExecute: (value) => { code = value; },
    });
    await handleBrowserAction(request('browser.click', { selector: '#save' }), deps(clickRelay, state));

    expect(code).toContain('__oc.select(null)');
    expect(state.lastTabId(state.sessionId('ses_1', null))).toBeUndefined();
  });

  test('does not remember a tab that belongs to another session', async () => {
    const state = new BridgeState();
    const relay = fakeRelay({
      targets: [{ ...ownTab, opencodeBrowserSessionId: 'oc-other' }],
    });

    const answer = await handleBrowserAction(
      request('browser.click', { tabId: 'T1', selector: '#save' }),
      deps(relay, state),
    );

    expect(answer.ok).toBe(false);
    expect(state.lastTabId(state.sessionId('ses_1', null))).toBeUndefined();
  });

  test('does not record a guessed fill viewport for a named tab with no known mode', async () => {
    const state = new BridgeState();
    let code = '';
    const relay = fakeRelay({
      targets: [ownTab],
      result: result({
        tabId: 'T1',
        url: 'https://example.com',
        title: 'Example',
        opened: true,
        settled: true,
        viewport: { mode: 'mobile', width: 390, height: 844 },
      }),
      onExecute: (value) => { code = value; },
    });

    await handleBrowserAction(
      request('browser.open', { url: 'https://example.com', tabId: 'T1' }),
      deps(relay, state),
    );

    expect(code).toContain('const mode = null');
    expect(state.viewport('T1')).toBe('mobile');
  });

  test('reports an explicit viewport on a new tab', async () => {
    let code = '';
    const relay = fakeRelay({
      result: result({
        tabId: 'T1',
        url: 'https://example.com',
        title: 'Example',
        opened: true,
        settled: true,
        viewport: { mode: 'mobile', width: 390, height: 844 },
      }),
      onExecute: (value) => { code = value; },
    });

    await handleBrowserAction(
      request('browser.open', { url: 'https://example.com', viewport: 'mobile' }),
      deps(relay),
    );

    expect(code).toContain('const mode = "mobile"');
    expect(code).toContain("mode || (created ? 'fill' : null)");
  });

  test('navigates the session blank page on the first open', async () => {
    let code = '';
    const relay = fakeRelay({
      result: result({
        tabId: 'T1',
        url: 'https://example.com',
        title: 'Example',
        opened: true,
        settled: true,
        viewport: { mode: 'fill', width: null, height: null },
      }),
      onExecute: (value) => { code = value; },
    });

    await handleBrowserAction(request('browser.open', { url: 'https://example.com' }), deps(relay));

    expect(code).toContain("page.url() === 'about:blank'");
    expect(code).toContain('? page :');
  });

  test('uses the tab the chat used last when tabId is omitted', async () => {
    const state = new BridgeState();
    const openRelay = fakeRelay({
      result: result({
        tabId: 'T1',
        url: 'https://example.com',
        title: 'Example',
        opened: true,
        settled: true,
        viewport: { mode: 'fill', width: null, height: null },
      }),
    });
    await handleBrowserAction(request('browser.open', { url: 'https://example.com' }), deps(openRelay, state));

    let code = '';
    const clickRelay = fakeRelay({
      targets: [ownTab],
      result: result({ clicked: '#save', label: 'Save', url: 'https://example.com' }),
      onExecute: (value) => { code = value; },
    });
    await handleBrowserAction(request('browser.click', { selector: '#save' }), deps(clickRelay, state));

    expect(code).toContain('__oc.select("T1")');
  });

  test('reads the screenshot from the relay media block', async () => {
    const relay = fakeRelay({
      targets: [ownTab],
      result: {
        text: '',
        isError: false,
        value: {
          ok: true,
          data: {
            width: 1280,
            height: 800,
            url: 'https://example.com',
            title: 'Example',
            viewport: { mode: 'fill', width: null, height: null },
            tabId: 'T1',
          },
        },
        media: [{ type: 'image', mimeType: 'image/png', data: 'BASE64', size: 3 }],
        session: { id: 'oc-ses_1' },
      },
    });

    const answer = await handleBrowserAction(
      request('browser.capture', { tabId: 'T1' }),
      deps(relay),
    );

    expect(answer).toEqual({
      ok: true,
      data: {
        base64: 'BASE64',
        mime: 'image/png',
        width: 1280,
        height: 800,
        url: 'https://example.com',
        title: 'Example',
        viewport: { mode: 'fill', width: null, height: null },
      },
    });
  });

  test('passes a label select through', async () => {
    let code = '';
    const relay = fakeRelay({
      targets: [ownTab],
      result: result({
        selector: '#country',
        label: 'Canada',
        value: 'ca',
        url: 'https://example.com',
      }),
      onExecute: (value) => { code = value; },
    });

    const answer = await handleBrowserAction(
      request('browser.select', { tabId: 'T1', selector: '#country', label: 'Canada' }),
      deps(relay),
    );

    expect(answer).toEqual({
      ok: true,
      data: { selector: '#country', label: 'Canada', value: 'ca', url: 'https://example.com' },
    });
    expect(code).toContain('Canada');
  });
});
