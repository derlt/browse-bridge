import fs from 'node:fs';
import path from 'node:path';

export type BridgeConfig = {
  /** The browse executable, or a command on PATH. */
  browseBin: string;
  /** The relay's port; browse's default is 19988. */
  relayPort: number;
  /** The browse data root, the equivalent of OPENCODE_BROWSER_HOME. */
  browseHome: string | null;
  /** Start `browse serve` when the relay is not reachable. */
  startRelay: boolean;
};

const DEFAULTS: BridgeConfig = {
  browseBin: 'browse',
  relayPort: 19_988,
  browseHome: null,
  startRelay: true,
};

/**
 * The optional `browse-bridge.json` next to the extension's `package.json`.
 * Every field is optional; an unreadable or malformed file means the defaults,
 * because a broken config must not keep the browser provider from starting.
 */
export function readBridgeConfig(extensionRoot: string): BridgeConfig {
  const file = path.join(extensionRoot, 'browse-bridge.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { ...DEFAULTS };
  }
  if (Object(raw) !== raw || raw === null) return { ...DEFAULTS };
  const value = raw as Record<string, unknown>;

  const browseBin = typeof value.browseBin === 'string' && value.browseBin.trim()
    ? value.browseBin.trim()
    : DEFAULTS.browseBin;
  const port = Number(value.relayPort);
  const relayPort = Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULTS.relayPort;
  const browseHome = typeof value.browseHome === 'string' && value.browseHome.trim()
    ? path.resolve(value.browseHome.trim())
    : null;
  const startRelay = value.startRelay === false ? false : DEFAULTS.startRelay;

  return { browseBin, relayPort, browseHome, startRelay };
}

/** The executable to spawn, preferring the install inside `browseHome` when one is configured. */
export function resolveBrowseBin(config: BridgeConfig): string {
  if (config.browseBin !== DEFAULTS.browseBin) return config.browseBin;
  if (config.browseHome) {
    const candidate = path.join(config.browseHome, 'bin', process.platform === 'win32' ? 'browse.exe' : 'browse');
    if (fs.existsSync(candidate)) return candidate;
  }
  return config.browseBin;
}
