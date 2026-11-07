# Browse Bridge

An OpenChamber extension that answers the agent's `browser.*` actions with the user's real browser through the [browse](https://github.com/anomalyco/browse) relay.

It implements the browser provider role (`contributes.service.provides: ["browser"]`), so `openchamber_web` stays the one browser tool the agent sees. Settings → OpenChamber Tools → Browser provider selects it.

## Requirements

- OpenChamber 2.0 or newer.
- browse installed and paired with a Chromium browser. The relay runs on the same machine as OpenChamber.
- Bun for the build.

## Build

```sh
bun install
bun run pack
```

`bun run pack` builds `service/main.js` and writes a clean extension folder to `dist/extension`, without `node_modules`, `src` or `test`.

`service/main.js` is build output and is not committed. Run `bun run build` or `bun run pack` before you install the extension from the repository folder.

## Install

1. Run `bun run pack`.
2. Settings → Extensions → install `dist/extension`.
3. Approve the local service. The manifest declares `exec: ["browse"]`.
4. Settings → OpenChamber Tools → Browser provider → Browse Bridge.
5. Ask an agent to open a page and read it.

The extension has no panel. Its card appears in Settings → Extensions; the browser provider dropdown is where it is selected.

## Configuration

Copy `browse-bridge.example.json` to `browse-bridge.json` next to the installed `package.json` when the defaults do not fit. For a packed extension that is `dist/extension/browse-bridge.json`:

```json
{
  "browseBin": "browse",
  "relayPort": 19988,
  "browseHome": null,
  "startRelay": true
}
```

- `browseBin`: the browse executable or a command on PATH. A `.mjs` or `.js` path is run with Node.
- `relayPort`: the relay port. browse's default is 19988.
- `browseHome`: the browse data root, the equivalent of `OPENCODE_BROWSER_HOME`. The relay token is read from `<browseHome>/relay-token`.
- `startRelay`: start `browse serve` when the relay is not reachable.

The service environment is an allowlist, so `OPENCODE_BROWSER_*` variables from the shell do not reach it. Use this file for a custom binary, port or data root.

## How it works

- The host posts one `browser.*` action to `POST /browser-control` on the service loopback.
- The service maps the OpenChamber session to a browse session, `oc-<sessionId>`.
- It calls the relay's `POST /cli/execute` with Playwright code generated for the action and reads the returned value.
- It calls `GET /json/list` to list the session's tabs and to refuse a `tabId` from another session.
- Page snapshots, clicks, typing, selects, scrolling and inspection run the same page scripts as OpenChamber's in-app panel, so an agent prompt written for the panel works here.

The relay's HTTP API is the one the browse MCP server uses. The bridge reads the relay token from the browse data root. It starts `browse serve` when the relay is down.

## Actions

All 12 actions are implemented: open, snapshot, click, type, select, scroll, back, forward, inspect, capture, resize, close.

- `browser.open` without `tabId` opens a background tab and answers its `tabId`. The first open uses the session's blank default page; later opens create new tabs.
- `browser.open` with `tabId` navigates that tab.
- `browser.snapshot` lists the session's tabs; pass one as `tabId`.
- `browser.close` without `tabId` closes the session's most recent tab.
- A `tabId` from another session is refused.

## Limitations

- No console problems in snapshots. The relay reports counts in `aftermath`, not the messages.
- No handoff, site secrets, recording or network capture through `openchamber_web`. The agent can still use browse's own MCP tools for those.
- The bridge does not adopt user tabs. It only drives tabs it opened.
- The relay's HTTP API is internal to browse. Pin the browse version you tested; a change to the API can break the bridge.

## Security

The service runs as the OpenChamber user and can drive every browser paired to the relay. It reads the relay token, which is readable only by that user. The approval dialog says the service has the user's access.

On a shared OpenChamber server, any agent can drive any paired browser. Run one OpenChamber instance per user, or pair only browsers you are willing to share.

The relay's own pairing and token remain the authentication. The bridge adds no network listener; its service loopback is reachable only by the host.
