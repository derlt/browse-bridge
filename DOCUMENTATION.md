# Browse Bridge

## Ownership

This extension owns the translation between OpenChamber's browser provider contract (`browser.*` actions at `POST /browser-control`) and the browse relay's HTTP API. It owns the session scope, the tab ownership check, and the result shapes the agent sees.

It does not own the page scripts. They mirror `packages/ui/src/lib/browser/pageActions.ts` in OpenChamber, so the in-app panel and this provider answer the same snapshot, click, type, select, scroll and inspect shapes.

It does not own the relay, the browser extension, pairing, or the browser. Those belong to browse.

## Invariants

- Every action is scoped to one browse session, derived from the OpenChamber chat as `oc-<sessionId>`. A missing chat uses `oc-default`.
- A `tabId` that does not belong to the calling session is refused. The provider never acts on another session's tab.
- `browser.open` without `tabId` uses the session's blank default page on the first open and creates a new background tab after that. It never navigates the user's tab.
- `browser.close` without `tabId` closes the session's most recent tab. It refuses a tab it did not open.
- An action failure is an HTTP 200 answer `{ ok: false, error }`. The host reads a non-200 as unknown page state and loses the message the agent needs.
- The relay token and the page's cookies never enter an answer. The service reads the token from the browse data root and uses it only on the relay request.
- The service adds no network listener. It listens on `127.0.0.1` for the host, and reaches the relay on `127.0.0.1`.
- The bridge never starts a browser. It drives the browser already paired to the relay.

## Decisions

### Why the relay HTTP API and not the MCP server

The relay exposes the same `POST /cli/execute` and `GET /json/list` the browse MCP server uses. One HTTP call per action is enough here, and an MCP client would add process supervision and JSON-RPC framing for no behavior. The cost is that the relay API is internal to browse, so the bridge pins the browse version it was tested with.

### Why the page scripts are mirrored from the panel

The browser provider contract says the agent sees one tool whoever drives the page. An agent prompt written against the panel's snapshot selectors and error messages must work against this provider. Copying the scripts keeps the selector generator, the caps, the click sequence and the select validation identical. A separate Playwright implementation would drift on the first panel change.

### Why target IDs come from CDP and the tab list from `/json/list`

Playwright pages have no stable public id. `Target.getTargetInfo` gives the CDP target ID, which survives navigation and is unique in the browser. The relay's `/json/list` carries that ID with `opencodeBrowserSessionId`, so the bridge can list only the session's tabs and refuse an ID from another session. `context.pages()` alone would include the user's tabs.

### Why the bridge keeps only in-memory state

The relay keeps the tabs. The bridge keeps the tab each chat used last and the viewport each tab was given, because the relay's summaries say neither. The state is per service process and dies with it; a restart falls back to the session's default page and to the size read from the page. No state file is needed, so a restart cannot leave stale tab ids behind.

### Why the first open navigates the blank default page

browse binds a default page to a new session before the sandbox code runs. Creating a second page for `browser.open` would leave the session's default page on `about:blank`, so every later action without `tabId` would read the blank tab. The first open navigates the default page instead; later opens create new tabs.

### Why screenshots travel as media

browse drops an execute value over 32 KB, and a base64 screenshot is larger than that. A Buffer returned in the value is extracted into the relay's `media` array before the size check. The bridge returns the Buffer and reads `media[0]`; a base64 string in the value would always arrive empty.

### Why the snapshot trims to a byte budget

The panel's caps are counts, not bytes: 6,000 characters of text and 120 elements can exceed the relay's 32 KB value cap, and the whole snapshot would be dropped. The page script drops elements and then text until the serialized result is under 28 KB, and reports the truncation. A partial snapshot is usable; a missing one is not.

### Why the viewport mode is remembered

Clearing Playwright's device metrics override through CDP resizes the page but leaves `page.viewportSize()` reporting the old size. The bridge remembers the mode it applied per tab and answers `fill` with null sizes; when the mode is unknown, it reads `innerWidth` and `innerHeight` from the page instead of trusting Playwright's record.

### Why the service starts the relay

The browser provider is started on the first action, often before an agent has used browse's own MCP tools. If the relay is down, the first action would otherwise fail with a setup message the agent cannot fix. The service spawns `browse serve` detached and waits for `/version`. The relay outlives the service, and the next action reuses it. `startRelay: false` keeps a deployment that manages the relay elsewhere from spawning a duplicate.

### Why the configuration is a file

The OpenChamber service environment is an allowlist. It carries PATH and HOME but not `OPENCODE_BROWSER_*`, so a custom relay port or data root cannot arrive through the shell. `browse-bridge.json` is read next to the manifest and is the only place those values can differ from browse's defaults.

### Why every action has a deadline

The host gives an open 45 s and every other action 20 s. The bridge spends part of that on a cold relay start and on the tab list, so it passes one deadline through `ensure`, `targets` and `execute` and reserves a margin for the HTTP answer. Without it, the host gives up first and the action can still run after the agent saw a timeout.

### Why the relay does not inherit the service token

The service token authenticates the host to the service. `browse serve` is spawned detached and outlives the service, so it must not keep the token. `browseEnv` deletes `OPENCHAMBER_SERVICE_TOKEN` and `OPENCHAMBER_SERVICE_PORT` before it adds the browse variables.

### Why no handoff, secrets, recording or network capture

The browser provider contract has 12 page actions. Handoff, site secrets, recordings and network capture belong to browse's MCP tools, where the agent can name them directly. Adding them to `openchamber_web` would widen the contract and the approval surface for behavior the host does not route. The bridge leaves them to browse.

### Why the session id is `oc-<sessionId>`

browse accepts lowercase letters, numbers, dashes and underscores, at most 63 characters. OpenChamber session ids already use that alphabet (`ses_...`). The `oc-` prefix keeps the bridge's sessions recognizable in `browse status` and avoids colliding with a session the user named by hand.

A null chat is not a scope of its own. A caller with a known project directory gets `oc-dir-<hash of the directory>`, and a caller with neither gets one random `oc-unscoped-<random>` bucket per service process. Otherwise two unscoped callers would share tabs and `active` state, which the contract says not to invent.
