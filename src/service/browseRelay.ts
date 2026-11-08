import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BridgeConfig } from './config.ts';
import { resolveBrowseBin } from './config.ts';

export type RelayTarget = {
  id: string;
  title: string;
  url: string;
  tabId?: number;
  sessionId?: string;
  opencodeBrowserSessionId?: string;
  owner?: string;
};

export type RelayExecuteResult = {
  text: string;
  value?: unknown;
  media?: Array<{ type: 'image'; mimeType: string; data: string; size: number }>;
  isError: boolean;
  session: { id: string };
};

export class RelayError extends Error {
  readonly code: string;

  constructor(message: string, code = 'RELAY_ERROR') {
    super(message);
    this.name = 'RelayError';
    this.code = code;
  }
}

/** How long a call may wait for the relay to start when the caller sets no deadline. */
const DEFAULT_START_BUDGET_MS = 10_000;
/** The shortest fetch timeout; below this a probe is not worth making. */
const MIN_FETCH_TIMEOUT_MS = 500;
/** The relay's `/version` probe is cheap; a second is enough. */
const VERSION_PROBE_MS = 1_000;

export type RelayCallOptions = {
  /** Absolute time by which the host needs an answer. */
  deadline?: number;
  /** How much of that time the relay may spend starting. */
  startBudgetMs?: number;
};

/** browse's data root: OPENCODE_BROWSER_HOME, else the XDG data folder plus `/browse`. */
export function browseDataRoot(config: BridgeConfig): string {
  if (config.browseHome) return config.browseHome;
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'browse');
}

export function relayTokenPath(config: BridgeConfig): string {
  return path.join(browseDataRoot(config), 'relay-token');
}

function readToken(config: BridgeConfig): string {
  try {
    const token = fs.readFileSync(relayTokenPath(config), 'utf8').trim();
    if (token) return token;
  } catch {
    // Fall through to the explanation below.
  }
  throw new RelayError(
    `browse relay token is missing at ${relayTokenPath(config)}. Start browse once so it creates the token, or set browseHome in browse-bridge.json.`,
    'RELAY_TOKEN_MISSING',
  );
}

/**
 * The environment for `browse serve`. The service token authenticates the host
 * to this service; browse does not need it, and the relay is detached and
 * outlives the service, so it must not keep it.
 */
export function browseEnv(config: BridgeConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.OPENCHAMBER_SERVICE_TOKEN;
  delete env.OPENCHAMBER_SERVICE_PORT;
  env.OPENCODE_BROWSER_PORT = String(config.relayPort);
  if (config.browseHome) env.OPENCODE_BROWSER_HOME = config.browseHome;
  return env;
}

/**
 * The relay on the user's machine. Agents, the CLI and this bridge reach it on
 * loopback; only the browser extension reaches it over the network.
 *
 * The bridge uses the relay's own HTTP API instead of the MCP server because it
 * needs one call per action and no MCP framing. The API is the same one the
 * MCP server uses, and the relay token is the same secret.
 */
export class BrowseRelay {
  private readonly config: BridgeConfig;
  private readonly baseUrl: string;
  private startingPromise: Promise<void> | null = null;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.baseUrl = `http://127.0.0.1:${config.relayPort}`;
  }

  /** Resolves once the relay answers; starts `browse serve` when it is down. */
  async ensure(options: RelayCallOptions = {}): Promise<void> {
    const now = Date.now();
    const deadline = options.deadline ?? now + DEFAULT_START_BUDGET_MS;
    if (await this.versionReachable(deadline)) return;
    if (!this.startingPromise) {
      const startDeadline = Math.min(deadline, now + (options.startBudgetMs ?? DEFAULT_START_BUDGET_MS));
      this.startingPromise = this.startIfNeeded(startDeadline).finally(() => {
        this.startingPromise = null;
      });
    }
    return this.startingPromise;
  }

  private async startIfNeeded(deadline: number): Promise<void> {
    if (await this.versionReachable(deadline)) return;
    if (!this.config.startRelay) {
      throw new RelayError(
        `browse relay is not reachable at ${this.baseUrl}. Start it with \`browse serve\` or set startRelay to true in browse-bridge.json.`,
        'RELAY_UNREACHABLE',
      );
    }

    const bin = resolveBrowseBin(this.config);
    const command = /\.(?:mjs|cjs|js)$/.test(bin) ? [process.execPath, bin] : [bin];
    let spawnError: Error | null = null;

    try {
      const child = spawn(command[0]!, [...command.slice(1), 'serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: browseEnv(this.config),
      });
      child.once('error', (error) => {
        spawnError = error;
      });
      child.once('exit', (code, signal) => {
        if (code !== 0 || signal) {
          spawnError = new Error(`browse serve exited (code ${code}, signal ${signal})`);
        }
      });
      child.unref();
    } catch (error) {
      throw new RelayError(
        `Could not start browse: ${error instanceof Error ? error.message : String(error)}`,
        'RELAY_START_FAILED',
      );
    }

    while (Date.now() < deadline) {
      if (await this.versionReachable(deadline)) return;
      if (spawnError) {
        if (await this.versionReachable(deadline)) return;
        throw this.spawnFailure(bin, spawnError);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new RelayError(
      `browse relay did not start at ${this.baseUrl} within the time limit. Run \`browse serve\` in a terminal to see why.`,
      'RELAY_START_TIMEOUT',
    );
  }

  private spawnFailure(bin: string, error: Error): RelayError {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return new RelayError(
        `browse was not found at ${bin}. Install browse or set browseBin in browse-bridge.json.`,
        'BROWSE_NOT_FOUND',
      );
    }
    return new RelayError(`Could not start browse: ${error.message}`, 'RELAY_START_FAILED');
  }

  private async versionReachable(deadline?: number): Promise<boolean> {
    const remaining = deadline === undefined ? VERSION_PROBE_MS : deadline - Date.now();
    if (remaining <= 0) return false;
    try {
      const response = await fetch(`${this.baseUrl}/version`, {
        signal: AbortSignal.timeout(Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(VERSION_PROBE_MS, remaining))),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async execute(
    code: string,
    options: { sessionId: string; timeoutMs: number } & RelayCallOptions,
  ): Promise<RelayExecuteResult> {
    await this.ensure(options);
    const token = readToken(this.config);
    const remaining = options.deadline === undefined
      ? options.timeoutMs + 5_000
      : options.deadline - Date.now();
    if (remaining <= 0) {
      throw new RelayError(
        'The browse relay did not answer within the host time limit. The page may still be loading; try again.',
        'RELAY_TIMEOUT',
      );
    }
    const relayTimeoutMs = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(options.timeoutMs, remaining - 500));
    const fetchTimeoutMs = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(options.timeoutMs + 5_000, remaining));

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/cli/execute`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: options.sessionId,
          code,
          createIfMissing: true,
          timeoutMs: relayTimeoutMs,
        }),
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new RelayError(
        timedOut
          ? `The browse relay did not answer within the time limit (${Math.round(fetchTimeoutMs / 1_000)} s). The page may still be loading; try again.`
          : `browse relay did not answer: ${error instanceof Error ? error.message : String(error)}`,
        timedOut ? 'RELAY_TIMEOUT' : 'RELAY_UNREACHABLE',
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new RelayError(
        `browse relay refused the action (${response.status}): ${text.slice(0, 500)}`,
        'RELAY_REJECTED',
      );
    }
    return await response.json() as RelayExecuteResult;
  }

  async targets(options: RelayCallOptions = {}): Promise<RelayTarget[]> {
    await this.ensure(options);
    const token = readToken(this.config);
    const remaining = options.deadline === undefined ? 5_000 : options.deadline - Date.now();
    if (remaining <= 0) {
      throw new RelayError(
        'The browse relay did not answer within the host time limit. Try again.',
        'RELAY_TIMEOUT',
      );
    }
    const fetchTimeoutMs = Math.max(MIN_FETCH_TIMEOUT_MS, Math.min(5_000, remaining));

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/json/list`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new RelayError(
        timedOut
          ? `The browse relay did not answer within the time limit (${Math.round(fetchTimeoutMs / 1_000)} s). Try again.`
          : `browse relay did not answer: ${error instanceof Error ? error.message : String(error)}`,
        timedOut ? 'RELAY_TIMEOUT' : 'RELAY_UNREACHABLE',
      );
    }
    if (!response.ok) {
      throw new RelayError(`browse relay refused the tab list (${response.status})`, 'RELAY_REJECTED');
    }
    const value: unknown = await response.json();
    return Array.isArray(value) ? value as RelayTarget[] : [];
  }
}
