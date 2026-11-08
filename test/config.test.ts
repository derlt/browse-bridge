import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBridgeConfig, resolveBrowseBin } from '../src/service/config.ts';
import { browseDataRoot } from '../src/service/browseRelay.ts';

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-config-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('readBridgeConfig', () => {
  test('returns the defaults when the file is missing', () => {
    expect(readBridgeConfig(tempRoot())).toEqual({
      browseBin: 'browse',
      relayPort: 19988,
      browseHome: null,
      startRelay: true,
    });
  });

  test('reads a partial file and fills the rest', () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'browse-bridge.json'), JSON.stringify({
      relayPort: 20_000,
      browseHome: '~/browse',
    }));

    const config = readBridgeConfig(root);

    expect(config.relayPort).toBe(20_000);
    expect(config.browseHome).toBe(path.resolve('~/browse'));
    expect(config.browseBin).toBe('browse');
    expect(config.startRelay).toBe(true);
  });

  test('ignores a malformed file and an invalid port', () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'browse-bridge.json'), '{not json');
    expect(readBridgeConfig(root).relayPort).toBe(19988);

    fs.writeFileSync(path.join(root, 'browse-bridge.json'), JSON.stringify({ relayPort: 70_000 }));
    expect(readBridgeConfig(root).relayPort).toBe(19988);
  });

  test('keeps startRelay false only when it is false', () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, 'browse-bridge.json'), JSON.stringify({ startRelay: false }));
    expect(readBridgeConfig(root).startRelay).toBe(false);

    fs.writeFileSync(path.join(root, 'browse-bridge.json'), JSON.stringify({ startRelay: 'no' }));
    expect(readBridgeConfig(root).startRelay).toBe(true);
  });
});

describe('resolveBrowseBin', () => {
  test('keeps a custom binary', () => {
    expect(resolveBrowseBin({
      browseBin: '/opt/browse',
      relayPort: 19988,
      browseHome: '/home/me/.browse',
      startRelay: true,
    })).toBe('/opt/browse');
  });

  test('prefers the install inside browseHome', () => {
    const root = tempRoot();
    const bin = path.join(root, 'bin', process.platform === 'win32' ? 'browse.exe' : 'browse');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');

    expect(resolveBrowseBin({
      browseBin: 'browse',
      relayPort: 19988,
      browseHome: root,
      startRelay: true,
    })).toBe(bin);
  });

  test('falls back to the command on PATH', () => {
    expect(resolveBrowseBin({
      browseBin: 'browse',
      relayPort: 19988,
      browseHome: tempRoot(),
      startRelay: true,
    })).toBe('browse');
  });
});

describe('browseDataRoot', () => {
  test('uses browseHome when set', () => {
    expect(browseDataRoot({
      browseBin: 'browse',
      relayPort: 19988,
      browseHome: '/data/browse',
      startRelay: true,
    })).toBe('/data/browse');
  });

  test('uses XDG_DATA_HOME when set', () => {
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = '/xdg';
    try {
      expect(browseDataRoot({
        browseBin: 'browse',
        relayPort: 19988,
        browseHome: null,
        startRelay: true,
      })).toBe('/xdg/browse');
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });
});
