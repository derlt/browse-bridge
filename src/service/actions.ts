import { createHash, randomBytes } from 'node:crypto';
import {
  BROWSER_PROVIDER_ACTION_TIMEOUT_MS,
  BROWSER_PROVIDER_OPEN_TIMEOUT_MS,
} from '@openchamber/sdk';
import type {
  BrowserClickParameters,
  BrowserInspectParameters,
  BrowserOpenData,
  BrowserOpenParameters,
  BrowserProviderData,
  BrowserProviderRequest,
  BrowserProviderResult,
  BrowserResizeData,
  BrowserResizeParameters,
  BrowserScrollParameters,
  BrowserSelectParameters,
  BrowserSnapshotData,
  BrowserSnapshotParameters,
  BrowserTab,
  BrowserTypeParameters,
  BrowserViewportMode,
  BrowserViewportSummary,
} from '@openchamber/sdk';
import type { BrowseRelay, RelayExecuteResult, RelayTarget } from './browseRelay.ts';
import {
  buildClickScript,
  buildInspectScript,
  buildScrollScript,
  buildSelectScript,
  buildSnapshotScript,
  buildTypeScript,
} from './pageScripts.ts';

export type BrowserActionDeps = {
  relay: BrowseRelay;
  state?: BridgeState;
};

/**
 * The bridge's per-process memory: the tab each chat used last, and the
 * viewport each tab was given. The relay keeps the tabs; this keeps only what
 * the relay's own summaries do not say.
 */
export class BridgeState {
  private readonly lastTabs = new Map<string, string>();
  private readonly viewports = new Map<string, BrowserViewportMode>();
  private readonly unscopedId = `oc-unscoped-${randomBytes(4).toString('hex')}`;

  /**
   * One browse session per chat. A null chat is not a scope of its own, so a
   * known project directory gets its own bucket and a caller with neither gets
   * one random bucket for this service process.
   */
  sessionId(sessionId: string | null, directory: string | null): string {
    if (sessionId) return `oc-${sanitizeSessionId(sessionId)}`;
    if (directory) return `oc-dir-${createHash('sha256').update(directory).digest('hex').slice(0, 16)}`;
    return this.unscopedId;
  }

  lastTabId(sessionId: string): string | undefined {
    return this.lastTabs.get(sessionId);
  }

  rememberTab(sessionId: string, tabId: string): void {
    this.lastTabs.set(sessionId, tabId);
  }

  forgetTab(sessionId: string, tabId: string): void {
    if (this.lastTabs.get(sessionId) === tabId) this.lastTabs.delete(sessionId);
    this.viewports.delete(tabId);
  }

  viewport(tabId: string | undefined): BrowserViewportMode | undefined {
    return tabId ? this.viewports.get(tabId) : undefined;
  }

  rememberViewport(tabId: string, mode: BrowserViewportMode): void {
    this.viewports.set(tabId, mode);
  }
}

function sanitizeSessionId(sessionId: string): string {
  const cleaned = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'default').slice(0, 60);
}

const defaultState = new BridgeState();

/**
 * Leave time for the HTTP answer before the host's own timeout fires. The host
 * reads a late answer as a failure and the action may already have run.
 */
const RESPONSE_MARGIN_MS = 1_500;
/** A cold relay start may use this much of an action's budget. */
const ACTION_START_BUDGET_MS = 4_000;
/** An open may wait longer for a cold relay; it has the larger budget. */
const OPEN_START_BUDGET_MS = 6_000;

class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

async function ownTargets(relay: BrowseRelay, sessionId: string, deadline: number): Promise<RelayTarget[]> {
  const targets = await relay.targets({ deadline, startBudgetMs: ACTION_START_BUDGET_MS });
  return targets.filter((target) => target.opencodeBrowserSessionId === sessionId);
}

async function requireOwnTarget(
  relay: BrowseRelay,
  sessionId: string,
  tabId: string,
  deadline: number,
): Promise<RelayTarget> {
  const own = await ownTargets(relay, sessionId, deadline);
  const target = own.find((entry) => entry.id === tabId);
  if (!target) {
    throw new ActionError(`No tab ${tabId} in this session; call browser.snapshot to list tabs.`);
  }
  return target;
}

async function requireAndRemember(
  relay: BrowseRelay,
  state: BridgeState,
  sessionId: string,
  tabId: string,
  deadline: number,
): Promise<void> {
  await requireOwnTarget(relay, sessionId, tabId, deadline);
  state.rememberTab(sessionId, tabId);
}

function cleanError(text: string): string {
  const trimmed = text.trim();
  return (trimmed || 'browse could not complete the action.').slice(0, 2_000);
}

function errorMessage(error: unknown): string {
  return cleanError(error instanceof Error ? error.message : String(error));
}

type WireValue = { ok?: unknown; error?: unknown; data?: unknown };

function readWire(result: RelayExecuteResult): BrowserProviderResult {
  if (result.isError) return { ok: false, error: cleanError(result.text) };

  const value = result.value;
  if (Object(value) !== value || value === null) {
    return { ok: false, error: 'browse returned no result for this action.' };
  }
  const wire = value as WireValue;
  if (wire.ok === false) {
    return {
      ok: false,
      error: typeof wire.error === 'string' && wire.error
        ? cleanError(wire.error)
        : 'browse could not complete the action.',
    };
  }
  if (wire.ok !== true || Object(wire.data) !== wire.data || wire.data === null) {
    return { ok: false, error: 'browse returned an unexpected result.' };
  }
  return { ok: true, data: wire.data as BrowserProviderData };
}

const COMMON = `
const __oc = {
  async targetId(p) {
    const cdp = await p.context().newCDPSession(p);
    try {
      const info = await cdp.send('Target.getTargetInfo');
      const id = info && info.targetInfo && info.targetInfo.targetId;
      if (!id) throw new Error('Could not identify the tab');
      return id;
    } finally {
      await cdp.detach().catch(() => {});
    }
  },
  async select(tabId) {
    if (!tabId) {
      if (!page) throw new Error('No page is open in this session. Call browser.open first.');
      return page;
    }
    const pages = context.pages();
    for (const p of pages) {
      let id;
      try { id = await __oc.targetId(p); } catch (error) { continue; }
      if (id === tabId) return p;
    }
    throw new Error('No tab ' + tabId + ' in this session; call browser.snapshot to list tabs.');
  },
  async viewportSummary(p, mode) {
    if (mode === 'fill') return { mode: 'fill', width: null, height: null };
    const size = await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const resolved = mode || (size.width === 390 && size.height === 844 ? 'mobile'
      : size.width === 820 && size.height === 1180 ? 'tablet'
      : size.width === 1280 && size.height === 800 ? 'desktop'
      : 'custom');
    return { mode: resolved, width: size.width, height: size.height };
  },
  async applyViewport(p, mode) {
    if (!mode || mode === 'fill') {
      const cdp = await p.context().newCDPSession(p);
      try { await cdp.send('Emulation.clearDeviceMetricsOverride'); } finally { await cdp.detach().catch(() => {}); }
      return;
    }
    const sizes = {
      mobile: { width: 390, height: 844 },
      tablet: { width: 820, height: 1180 },
      desktop: { width: 1280, height: 800 }
    };
    const size = sizes[mode];
    if (!size) throw new Error('Unknown viewport ' + mode);
    await p.setViewportSize(size);
  }
};
`;

const tabArgument = (tabId: string | undefined): string => JSON.stringify(tabId ?? null);
const modeArgument = (mode: BrowserViewportMode | undefined): string => JSON.stringify(mode ?? null);

function openCode(
  parameters: BrowserOpenParameters,
  tabId: string | undefined,
  mode: BrowserViewportMode | undefined,
): string {
  // browse binds a blank default page to a new session before the code runs.
  // Navigating that page on the first open keeps the session's default page
  // and the tab the agent opened the same tab, so a later action without
  // tabId does not read about:blank.
  const openPage = tabId
    ? `const p = await __oc.select(${JSON.stringify(tabId)});\nconst created = false;`
    : 'const reused = page && page.url() === \'about:blank\';\nconst p = reused ? page : await context.newPage();\nconst created = !reused;';
  const closeOnError = tabId ? '' : 'await p.close().catch(() => {});';
  return `
${COMMON}
const url = ${JSON.stringify(parameters.url)};
const viewport = ${JSON.stringify(parameters.viewport ?? null)};
const mode = ${modeArgument(mode)};
${openPage}
try {
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch (error) {
  ${closeOnError}
  throw error;
}
let settled = true;
try { await p.waitForLoadState('networkidle', { timeout: 5000 }); } catch (error) { settled = false; }
if (viewport) await __oc.applyViewport(p, viewport);
const id = await __oc.targetId(p);
return {
  ok: true,
  data: {
    tabId: id,
    url: p.url(),
    title: await p.title(),
    opened: true,
    settled,
    viewport: await __oc.viewportSummary(p, mode || (created ? 'fill' : null))
  }
};
`;
}

function snapshotCode(
  parameters: BrowserSnapshotParameters,
  tabId: string | undefined,
  mode: BrowserViewportMode | undefined,
): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildSnapshotScript({ selector: parameters.selector }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Snapshot failed' };
const activeTabId = await __oc.targetId(p);
const data = {
  url: result.url,
  title: result.title,
  scope: result.scope,
  scrollY: result.scrollY,
  maxScrollY: result.maxScrollY,
  text: result.text,
  elements: result.elements,
  viewport: await __oc.viewportSummary(p, ${modeArgument(mode)}),
  activeTabId
};
if (result.textTruncated) data.textTruncated = true;
if (result.textTotalChars !== undefined) data.textTotalChars = result.textTotalChars;
if (result.elementsTruncated) data.elementsTruncated = true;
if (result.interactiveElementsOnPage !== undefined) data.interactiveElementsOnPage = result.interactiveElementsOnPage;
return { ok: true, data };
`;
}

function clickCode(parameters: BrowserClickParameters, tabId: string | undefined): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildClickScript({ selector: parameters.selector, text: parameters.text }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Click failed' };
return { ok: true, data: { clicked: result.clicked, label: result.label, url: result.url } };
`;
}

function typeCode(parameters: BrowserTypeParameters, tabId: string | undefined): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildTypeScript({
    selector: parameters.selector,
    value: parameters.value,
    submit: parameters.submit,
  }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Typing failed' };
return { ok: true, data: { selector: result.selector, url: result.url } };
`;
}

function selectCode(parameters: BrowserSelectParameters, tabId: string | undefined): string {
  const script = 'label' in parameters
    ? buildSelectScript({ selector: parameters.selector, label: parameters.label })
    : buildSelectScript({ selector: parameters.selector, value: parameters.value });
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(script)});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Selecting failed' };
return { ok: true, data: { selector: result.selector, label: result.label, value: result.value, url: result.url } };
`;
}

function scrollCode(parameters: BrowserScrollParameters, tabId: string | undefined): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildScrollScript({ selector: parameters.selector, direction: parameters.direction }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Scrolling failed' };
const data = { scrollY: result.scrollY, maxScrollY: result.maxScrollY, atTop: result.atTop, atBottom: result.atBottom };
if (result.scrolledTo) data.scrolledTo = result.scrolledTo;
if (result.direction) data.direction = result.direction;
return { ok: true, data };
`;
}

function navigationCode(direction: 'back' | 'forward', tabId: string | undefined): string {
  const call = direction === 'back' ? 'goBack' : 'goForward';
  const label = direction === 'back' ? 'go back to' : 'go forward to';
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const before = p.url();
const response = await p.${call}({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
if (!response && p.url() === before) return { ok: false, error: 'There is nothing to ${label} in this tab' };
return { ok: true, data: { url: p.url(), title: await p.title() } };
`;
}

function inspectCode(parameters: BrowserInspectParameters, tabId: string | undefined): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
const result = await p.evaluate(${JSON.stringify(buildInspectScript({ selector: parameters.selector }))});
if (!result || result.ok !== true) return { ok: false, error: (result && result.error) || 'Inspect failed' };
return {
  ok: true,
  data: {
    selector: result.selector,
    tag: result.tag,
    label: result.label,
    bounds: result.bounds,
    inViewport: result.inViewport,
    styles: result.styles
  }
};
`;
}

function captureCode(tabId: string | undefined, mode: BrowserViewportMode | undefined): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
let buffer = await p.screenshot({ type: 'png' });
if (buffer.length > 8000000) buffer = await p.screenshot({ type: 'jpeg', quality: 80 });
const size = await p.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
const id = await __oc.targetId(p);
return {
  ok: true,
  data: {
    image: buffer,
    width: size.width,
    height: size.height,
    url: p.url(),
    title: await p.title(),
    viewport: await __oc.viewportSummary(p, ${modeArgument(mode)}),
    tabId: id
  }
};
`;
}

function resizeCode(parameters: BrowserResizeParameters, tabId: string | undefined): string {
  return `
${COMMON}
const p = await __oc.select(${tabArgument(tabId)});
await __oc.applyViewport(p, ${JSON.stringify(parameters.viewport)});
const id = await __oc.targetId(p);
return {
  ok: true,
  data: {
    viewport: await __oc.viewportSummary(p, ${JSON.stringify(parameters.viewport)}),
    tabId: id
  }
};
`;
}

function closeCode(tabId: string): string {
  return `
${COMMON}
const p = await __oc.select(${JSON.stringify(tabId)});
const id = await __oc.targetId(p);
await p.close();
return { ok: true, data: { closed: true, tabId: id } };
`;
}

async function run(
  relay: BrowseRelay,
  sessionId: string,
  code: string,
  timeoutMs: number,
  deadline: number,
  startBudgetMs: number,
): Promise<BrowserProviderResult> {
  return readWire(await relay.execute(code, { sessionId, timeoutMs, deadline, startBudgetMs }));
}

async function snapshotResult(
  relay: BrowseRelay,
  state: BridgeState,
  sessionId: string,
  parameters: BrowserSnapshotParameters,
  tabId: string | undefined,
  deadline: number,
  startBudgetMs: number,
): Promise<BrowserProviderResult> {
  const result = await run(
    relay,
    sessionId,
    snapshotCode(parameters, tabId, state.viewport(tabId)),
    18_000,
    deadline,
    startBudgetMs,
  );
  if (!result.ok) return result;

  const wire = result.data as BrowserSnapshotData & { activeTabId?: string };
  const { activeTabId, ...data } = wire;
  if (activeTabId) state.rememberTab(sessionId, activeTabId);
  try {
    const own = await ownTargets(relay, sessionId, deadline);
    data.tabs = own.map((target): BrowserTab => ({
      id: target.id,
      // The relay reports the URL as a target title; the page has the real one.
      title: target.id === activeTabId ? data.title : target.title,
      url: target.url,
      active: target.id === activeTabId,
    }));
  } catch {
    // Tabs are optional; a snapshot without them is still usable.
  }
  return { ok: true, data };
}

async function captureResult(
  relay: BrowseRelay,
  state: BridgeState,
  sessionId: string,
  tabId: string | undefined,
  timeoutMs: number,
  deadline: number,
  startBudgetMs: number,
): Promise<BrowserProviderResult> {
  const raw = await relay.execute(captureCode(tabId, state.viewport(tabId)), {
    sessionId,
    timeoutMs,
    deadline,
    startBudgetMs,
  });
  const wire = readWire(raw);
  if (!wire.ok) return wire;

  const data = wire.data as {
    width: number;
    height: number;
    url: string;
    title: string;
    viewport: BrowserViewportSummary;
    tabId?: string;
  };
  if (data.tabId) state.rememberTab(sessionId, data.tabId);

  const media = raw.media?.[0];
  if (!media) {
    return { ok: false, error: 'browse did not return the screenshot. Try browser.capture again.' };
  }
  return {
    ok: true,
    data: {
      base64: media.data,
      mime: media.mimeType,
      width: data.width,
      height: data.height,
      url: data.url,
      title: data.title,
      viewport: data.viewport,
    },
  };
}

/**
 * Maps one `browser.*` action to browse's relay. The host already validated
 * the parameters; this owns the session scope, the tab ownership check, and
 * the translation of browse's result into the panel's answer shape.
 */
export async function handleBrowserAction(
  request: BrowserProviderRequest,
  deps: BrowserActionDeps,
): Promise<BrowserProviderResult> {
  const state = deps.state ?? defaultState;
  const sessionId = state.sessionId(request.context.sessionId, request.context.directory);
  const tabId = request.parameters.tabId;
  let effectiveTabId = tabId;

  const hostLimitMs = request.action === 'browser.open'
    ? BROWSER_PROVIDER_OPEN_TIMEOUT_MS
    : BROWSER_PROVIDER_ACTION_TIMEOUT_MS;
  const deadline = Date.now() + hostLimitMs - RESPONSE_MARGIN_MS;
  const startBudgetMs = request.action === 'browser.open' ? OPEN_START_BUDGET_MS : ACTION_START_BUDGET_MS;

  try {
    if (request.action !== 'browser.open' && !tabId) {
      const remembered = state.lastTabId(sessionId);
      if (remembered) {
        const own = await ownTargets(deps.relay, sessionId, deadline);
        if (own.some((target) => target.id === remembered)) {
          effectiveTabId = remembered;
        } else {
          state.forgetTab(sessionId, remembered);
        }
      }
    }

    switch (request.action) {
      case 'browser.open': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        const mode = request.parameters.viewport ?? state.viewport(tabId);
        const result = await run(
          deps.relay,
          sessionId,
          openCode(request.parameters, tabId, mode),
          40_000,
          deadline,
          startBudgetMs,
        );
        if (result.ok) {
          const data = result.data as BrowserOpenData;
          if (data.tabId) {
            state.rememberTab(sessionId, data.tabId);
            if (mode) state.rememberViewport(data.tabId, mode);
            else if (data.viewport.mode !== 'custom') state.rememberViewport(data.tabId, data.viewport.mode);
          }
        }
        return result;
      }
      case 'browser.snapshot': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await snapshotResult(
          deps.relay,
          state,
          sessionId,
          request.parameters,
          effectiveTabId,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.click': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(
          deps.relay,
          sessionId,
          clickCode(request.parameters, effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.type': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(
          deps.relay,
          sessionId,
          typeCode(request.parameters, effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.select': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(
          deps.relay,
          sessionId,
          selectCode(request.parameters, effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.scroll': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(
          deps.relay,
          sessionId,
          scrollCode(request.parameters, effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.back':
      case 'browser.forward': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(
          deps.relay,
          sessionId,
          navigationCode(request.action === 'browser.back' ? 'back' : 'forward', effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.inspect': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await run(
          deps.relay,
          sessionId,
          inspectCode(request.parameters, effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.capture': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        return await captureResult(
          deps.relay,
          state,
          sessionId,
          effectiveTabId,
          18_000,
          deadline,
          startBudgetMs,
        );
      }
      case 'browser.resize': {
        if (tabId) await requireAndRemember(deps.relay, state, sessionId, tabId, deadline);
        const result = await run(
          deps.relay,
          sessionId,
          resizeCode(request.parameters, effectiveTabId),
          18_000,
          deadline,
          startBudgetMs,
        );
        if (result.ok) {
          const data = result.data as BrowserResizeData & { tabId?: string };
          if (data.tabId) {
            state.rememberTab(sessionId, data.tabId);
            state.rememberViewport(data.tabId, request.parameters.viewport);
          }
        }
        return result;
      }
      case 'browser.close': {
        let targetId = effectiveTabId;
        if (targetId) {
          // Closing a background tab must not make it the chat's last-used
          // tab, so this checks ownership without remembering it.
          if (tabId) await requireOwnTarget(deps.relay, sessionId, tabId, deadline);
        } else {
          const own = await ownTargets(deps.relay, sessionId, deadline);
          const last = own[own.length - 1];
          if (!last) return { ok: false, error: 'No tab in this session to close. Call browser.open first.' };
          targetId = last.id;
        }
        const result = await run(
          deps.relay,
          sessionId,
          closeCode(targetId),
          18_000,
          deadline,
          startBudgetMs,
        );
        if (result.ok) state.forgetTab(sessionId, targetId);
        return result;
      }
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
