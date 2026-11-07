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
  async ensure(): Promise<void> {
    if (await this.versionReachable()) return;
    if (!this.startingPromise) {
      this.startingPromise = this.startIfNeeded().finally(() => {
        this.startingPromise = null;
      });
    }
    return this.startingPromise;
  }

  private async startIfNeeded(): Promise<void> {
    if (await this.versionReachable()) return;
    if (!this.config.startRelay) {
      throw new RelayError(
        `browse relay is not reachable at ${this.baseUrl}. Start it with \`browse serve\` or set startRelay to true in browse-bridge.json.`,
        'RELAY_UNREACHABLE',
      );
    }

    const bin = resolveBrowseBin(this.config);
    const command = /\.(?:mjs|cjs|js)$/.test(bin) ? [process.execPath, bin] : [bin];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENCODE_BROWSER_PORT: String(this.config.relayPort),
    };
    if (this.config.browseHome) env.OPENCODE_BROWSER_HOME = this.config.browseHome;

    try {
      const child = spawn(command[0]!, [...command.slice(1), 'serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env,
      });
      child.on('error', () => {});
      child.unref();
    } catch (error) {
      throw new RelayError(
        `Could not start browse: ${error instanceof Error ? error.message : String(error)}`,
        'RELAY_START_FAILED',
      );
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await this.versionReachable()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new RelayError(
      `browse relay did not start at ${this.baseUrl}. Run \`browse serve\` in a terminal to see why.`,
      'RELAY_START_TIMEOUT',
    );
  }

  private async versionReachable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/version`, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async execute(code: string, options: { sessionId: string; timeoutMs: number }): Promise<RelayExecuteResult> {
    await this.ensure();
    const token = readToken(this.config);
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
          timeoutMs: options.timeoutMs,
        }),
        signal: AbortSignal.timeout(options.timeoutMs + 5_000),
      });
    } catch (error) {
      throw new RelayError(
        `browse relay did not answer: ${error instanceof Error ? error.message : String(error)}`,
        'RELAY_UNREACHABLE',
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

  async targets(): Promise<RelayTarget[]> {
    await this.ensure();
    const token = readToken(this.config);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/json/list`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new RelayError(
        `browse relay did not answer: ${error instanceof Error ? error.message : String(error)}`,
        'RELAY_UNREACHABLE',
      );
    }
    if (!response.ok) {
      throw new RelayError(`browse relay refused the tab list (${response.status})`, 'RELAY_REJECTED');
    }
    const value: unknown = await response.json();
    return Array.isArray(value) ? value as RelayTarget[] : [];
  }
}
