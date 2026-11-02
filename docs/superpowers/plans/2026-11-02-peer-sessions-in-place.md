# Peer Sessions In Place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a peer's session (terminal, images, image viewer, docs, git graph, Kill) inside this client on this origin, addressed by `?host=<peer>`, with the server relaying HTTP and the pty to the peer.

**Architecture:** The server gains an allowlisted HTTP relay (`/api/peers/:name/…` → `<peer>/api/…`) and a WebSocket relay (`/ws/peers/<name>/pty/<id>` → `<peer>/ws/pty/<id>`), both using the shared token. The web client resolves `?host=` against `/api/peers` (never falling back to this instance for an unknown host) and routes every session/git/docs call through one helper, `hostApi`.

**Tech Stack:** Node 22, Hono 4, `ws` 8, vitest; React 19, react-router, TanStack Query, xterm 6.

**Spec:** `docs/superpowers/specs/2026-11-02-peer-sessions-in-place-design.md`

## Global Constraints

- Everything in English (code, comments, copy, server messages). Only Tailwind utilities + shadcn; lucide icons with `size`.
- Error bodies are always `{ error }`.
- Relay allowlist is exactly the spec's table; anything else under `/api/peers/:name/` → 404 `{error: "not found"}`.
- Relay messages: offline/unreachable/non-json error → 502 `{error: "<name> is not reachable"}`; timeout → 504 `{error: "<name> did not answer within 30 s"}`. Relay timeout 30 s.
- Response headers passed back: `content-type`, `content-length`, `x-content-type-options`, `content-security-policy`, `cache-control` — nothing else.
- WS relay: dial timeout 10 s; peer-side ping every 30 s, terminate on a missed pong; close codes 1000 and 3000–4999 mirrored as-is, anything else → 1011.
- `SESSION_GONE_CODE` (4404) must reach the browser intact.
- A `?host=` is never resolved as this instance unless it equals `self`; unknown → not found.
- Pure logic in `apps/web/src/lib`, tested in node (no jsdom). Tests never touch real tmux.
- Run from the repo root: `pnpm test && pnpm typecheck` must pass at the end of every task.

## Review Focus

1. The browser's socket closes while the peer dial is still pending → the peer socket is closed once it opens (no orphan attach on the peer). Test in Task 2.
2. A param carrying `%2F` or `..` (`/api/peers/mac/sessions/..%2F..%2Fsettings/image`) → 404 here, the peer is never called. Test in Task 1.
3. An image answer through the relay → bytes identical, `content-type`/`nosniff`/CSP kept. Test in Task 1.
4. `?host=<self>` resolves to this instance; `?host=<old-name>` never does (Kill must not hit a local session with the same id). Test in Task 3.
5. The peer drops abnormally mid-session (sleep, crash) → the browser gets 1011 (retryable), never 4404 and never a hang. Test in Task 2.

---

### Task 1: Server HTTP relay

**Files:**
- Create: `apps/server/src/peers/relay.ts`
- Modify: `apps/server/src/http/routes/peers.ts`
- Test: `apps/server/test/peers/relay.test.ts`, `apps/server/test/http/peers.test.ts` (extend; reuse `withPeers`, `stubLink`)

**Interfaces:**
- Produces:
  - `matchRelay(method: string, segments: string[], query: URLSearchParams): string | null` — `segments` are the **raw** (still percent-encoded) path segments after `/api/peers/<name>/`. Each is decoded with `decodeURIComponent` (failure → null); a decoded segment that is empty, `.`/`..`, or contains `/` → null. Returns the peer path `/api/…` with each param re-encoded by `encodeURIComponent`, or null when off the allowlist. `DELETE sessions/:id` with a `remove` query param → null.
  - `relayRequest(peer: PeerConfig, token: string, req: { method: string; peerPath: string; search: string; contentType: string | null; body: ReadableStream<Uint8Array> | null }, opts?: { fetch?: typeof fetch; timeoutMs?: number }): Promise<Response>` — fetches `${peer.url}${peerPath}${search}` with only `x-mojito-token` (+ `content-type` when given; body with `duplex: "half"`), returns a `Response` with the peer's status, the filtered headers and the body stream untouched. On a non-2xx answer whose body is not json, and on fetch failure → 502 json; on timeout → 504 json (messages per Global Constraints).
  - `RELAY_TIMEOUT_MS = 30_000`.
- Route: `.all("/peers/:name/*", …)` in `peerRoutes`, **after** the existing `.post("/peers/:name/sessions")` (that launch forward keeps winning). Raw segments come from `new URL(c.req.url).pathname`, never `c.req.path` (decoded). Order: unknown peer → 404 `peer not found: <name>`; no match → 404 `not found`; peer offline → 502 without fetching; else `relayRequest`.

- [ ] **Step 1: Write the failing tests**

`relay.test.ts` — `matchRelay`:
- `("GET", ["sessions","mj-a","image"], q("path=x.png"))` → `"/api/sessions/mj-a/image"`
- each allowlisted row of the spec table maps to its peer path (`DELETE sessions/:id`, `POST sessions/:id/images`, `GET projects/:p/git/graph`, `…/git/commits/:hash`, `…/git/commits/:hash/diff`, `…/docs`, `…/docs/file`)
- `("GET", ["projects","my%20proj","docs"])` → `"/api/projects/my%20proj/docs"` (decoded then re-encoded)
- `("GET", ["sessions","..%2F..%2Fsettings","image"])` → null; `("GET", ["sessions","..","image"])` → null; `("GET", ["sessions","%E0%A4%A","image"])` → null
- `("DELETE", ["sessions","mj-a"], q("remove=1"))` → null; `("PUT", ["settings"])` → null; `("POST", ["hook"])` → null; `("GET", ["sessions","mj-a"])` → null

`peers.test.ts` — `ALL /api/peers/:name/*`, with an injected `peerFetch`:
- `GET /api/peers/mac/sessions/mj-a/image?path=a.png` → fetch called once with `https://mac.t.ts.net/api/sessions/mj-a/image?path=a.png`, header `x-mojito-token` = the setup token, no other browser header (send `cookie: x` and assert it is absent); peer answers bytes `[0x89,0x50,0x4e,0x47,0,1,2]` with `content-type: image/png`, `x-content-type-options: nosniff`, `content-security-policy: sandbox; default-src 'none'`, `cache-control: no-store`, `set-cookie: a=b` → status 200, identical bytes, the four headers kept, `set-cookie` absent.
- `DELETE /api/peers/mac/sessions/mj-a` → peer's 409 `{error:"claude did not exit: open the terminal"}` passed verbatim.
- `POST /api/peers/mac/sessions/mj-a/images` with a multipart body → the peer receives the same `content-type` (boundary included) and the same bytes.
- `GET /api/peers/mac/sessions/..%2F..%2Fsettings/image` → 404, fetch not called.
- `PUT /api/peers/mac/settings` → 404, fetch not called.
- `GET /api/peers/nope/sessions/mj-a/image?path=a.png` → 404 `{error:"peer not found: nope"}`.
- `GET /api/peers/air/…` (offline stub) → 502 `{error:"air is not reachable"}`, fetch not called.
- fetch rejects → 502 `{error:"mac is not reachable"}`; fetch rejects with a `TimeoutError` `DOMException` → 504 `{error:"mac did not answer within 30 s"}`.
- peer answers 500 with a text body → 502.
- `POST /api/peers/mac/sessions` still forwards the launch (existing tests stay green).
- no `x-mojito-token` → 401 (the `/api/*` middleware), fetch not called.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mojito/server exec vitest run test/peers/relay.test.ts test/http/peers.test.ts`
Expected: FAIL (`matchRelay` not exported; relay routes 404).

- [ ] **Step 3: Implement `matchRelay`, `relayRequest` in `peers/relay.ts` and the route in `routes/peers.ts`**

Allowlist as a small table of `{ method, pattern: string[] }` with `:param` slots; the header filter is a fixed set. Update the file comment of `peerRoutes` ("Nothing else is forwarded …") to say what is relayed.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @mojito/server exec vitest run test/peers test/http/peers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/peers/relay.ts apps/server/src/http/routes/peers.ts apps/server/test/peers/relay.test.ts apps/server/test/http/peers.test.ts
git commit -m "feat(server): relay a peer session's http calls"
```

### Task 2: Server pty relay

**Files:**
- Create: `apps/server/src/ws/peerPty.ts`
- Modify: `apps/server/src/ws/upgrade.ts`, `apps/server/src/main.ts:127`
- Test: `apps/server/test/ws/peerPty.test.ts` (real `ws` servers on port 0), `apps/server/test/ws/upgrade.test.ts` (extend)

**Interfaces:**
- Consumes: `PeerRegistry.config(name)`, `PeerRegistry.online(name)`; `markAlive` (heartbeat.ts); `SESSION_GONE_CODE`, `PREFIX`.
- Produces:
  - `peerPtyUrl(peerUrl: string, id: string, token: string): string` — `http→ws`, `https→wss`, `${…}/ws/pty/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`.
  - `mirrorCode(code: number): number` — 1000 and 3000–4999 as-is, else 1011.
  - `dialPeer(url: string, timeoutMs = 10_000): Promise<WebSocket>` — `ws` client; rejects on error/unexpected-response/timeout (terminating the socket).
  - `relayPeerPty(browser: WebSocket, upstream: WebSocket, opts?: { pingMs?: number }): void` — pipes messages both ways preserving `isBinary` (`send(data, { binary: isBinary })`); browser close → `upstream.close(1000)`; upstream close(code) → `browser.close(mirrorCode(code))`; errors on either side close the other with 1011; pings `upstream` every `pingMs` (default 30 000) and terminates it after a missed pong; clears the timer on close.
  - `UpgradeDeps` gains `peers?: Pick<PeerRegistry, "config" | "online">` and `dial?: (url: string) => Promise<WebSocket>` (default `dialPeer`).
- Upgrade path `/ws/peers/<name>/pty/<id>` (both segments decoded; a nested path or a decode failure → destroy). Unknown peer or id not starting with `PREFIX` → destroy. Offline → complete the handshake, `close(1011, "<name> is not reachable")`. Else dial **before** `wss.handleUpgrade`; dial failure → complete and close 1011; success → `handleUpgrade`, `markAlive(browser)`, `relayPeerPty`. If the raw `socket` emits `close` while dialling, close the upstream on arrival and do not complete the handshake.
- `main.ts`: pass `peers` into the `handleUpgrade` deps.

- [ ] **Step 1: Write the failing tests**

`peerPty.test.ts` (fake peer = `new WebSocketServer({ port: 0 })`; this instance = an http server on port 0 whose `upgrade` calls `handleUpgrade` with `peers` stubbed to `{ config: () => ({ name: "mac", url: "http://127.0.0.1:<peerPort>" }), online: () => true }`; `vi.mock("node-pty")` as upgrade.test does):
- the peer sees a connection on `/ws/pty/mj-a?token=tok`.
- browser binary `[1,2,3]` arrives at the peer as binary; browser text `{"resize":{"cols":120,"rows":40}}` arrives as text; peer text `"hello"` arrives at the browser as text.
- peer closes 4404 → browser close event code 4404.
- peer `terminate()`s → browser close code 1011.
- browser closes → peer sees close code 1000.
- offline (`online: () => false`) → browser opens then gets close 1011; peer saw no connection.
- dial refused (peer url points to a closed port) → browser close 1011.
- browser aborts while dial is pending (`dial` stubbed with a deferred promise; client `terminate()` before resolving; then resolve with a socket) → that upstream socket gets `close` called.
- `relayPeerPty` with `pingMs: 20` and an upstream that never pongs → upstream terminated, browser closed 1011.

`upgrade.test.ts`: `/ws/peers/nope/pty/mj-a?token=tok` → `socket.destroy` called; `/ws/peers/mac/pty/other?token=tok` → destroyed; `/ws/peers/mac/pty/mj-a/x?token=tok` → destroyed; bad token → 401 as today.

Unit: `mirrorCode(1000)=1000`, `(4404)=4404`, `(1005)=1011`, `(1006)=1011`, `(1001)=1011`; `peerPtyUrl("https://mac.t.ts.net","mj-a b","t k")` = `"wss://mac.t.ts.net/ws/pty/mj-a%20b?token=t%20k"`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mojito/server exec vitest run test/ws`
Expected: FAIL (`peerPty` module missing; peer paths destroyed).

- [ ] **Step 3: Implement `ws/peerPty.ts`, the upgrade branch, and the `main.ts` wiring**

Extend the `handleUpgrade` doc comment with the third path.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @mojito/server exec vitest run test/ws && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws apps/server/src/main.ts apps/server/test/ws
git commit -m "feat(server): relay a peer session's terminal"
```

### Task 3: Web host addressing

**Files:**
- Create: `apps/web/src/lib/host.ts`, `apps/web/src/hooks/useHost.ts`
- Modify: `apps/web/src/lib/git/url.ts`, `apps/web/src/lib/docs/url.ts`, `apps/web/src/lib/queryKeys.ts`, `apps/web/src/components/board/GitButtons.tsx` (key call only)
- Test: `apps/web/test/lib/host.test.ts`, `apps/web/test/lib/git/url.test.ts`, `apps/web/test/lib/docs/url.test.ts`

**Interfaces:**
- Produces (`lib/host.ts`):
  - `type HostResolution = { kind: "self" } | { kind: "peer"; peer: PeerSnapshot } | { kind: "unknown"; name: string } | { kind: "loading" }`
  - `resolveHost(param: string | null, answer: PeersAnswer | undefined): HostResolution` — `null`/`""` → self (no wait); `answer` undefined → loading; `=== answer.self` → self; a peer by name → peer; else unknown.
  - `hostApi(host: string | null, path: string): string` — `path` starts with `/api/`; `null` → `path`; else `/api/peers/${encodeURIComponent(host)}/${path.slice(5)}`.
  - `ptyPath(host: string | null, id: string): string` — `/ws/pty/<enc id>` or `/ws/peers/<enc host>/pty/<enc id>`.
  - `sessionHref(host: string | null, id: string): string` — `/session/<enc id>` plus `?host=<enc host>` when host.
  - `hostOf(r: HostResolution): string | null` — the peer's name for `peer`, else null.
- `useHost(): HostResolution` — `useSearchParams().get("host")` + `usePeers().data`.
- `GitView` and `DocsView` gain `host: string | null`: parse keeps any non-empty `host` as written; `gitHref`/`docsHref` write `host` **first** when set.
- `gitKeys`/`docKeys`: every key takes `host: string | null` as the **first** argument and puts `host ?? ""` right after the `"git"`/`"docs"` head (`["git", host ?? "", project, …]`). `GitButtons` calls `gitKeys.graphs(null, project)`.

- [ ] **Step 1: Write the failing tests**

- `resolveHost(null, undefined)` → `{kind:"self"}`; `("mac", undefined)` → loading; `("box", {self:"box",peers:[]})` → self; `("mac", answerWithMac)` → peer mac; `("192.168.1.5", answerWithMac)` → `{kind:"unknown", name:"192.168.1.5"}`.
- `hostApi(null, "/api/sessions/mj-a")` → same; `hostApi("mac", "/api/sessions/mj-a/image?path=x")` → `"/api/peers/mac/sessions/mj-a/image?path=x"`.
- `ptyPath(null,"mj-a")` → `"/ws/pty/mj-a"`; `ptyPath("mac","mj-a")` → `"/ws/peers/mac/pty/mj-a"`.
- `sessionHref(null,"mj-a")` → `"/session/mj-a"`; `sessionHref("mac","mj-a")` → `"/session/mj-a?host=mac"`.
- `gitHref("p", { host: "mac", ticket: "RIC-5" })` → `"/git/p?host=mac&ticket=RIC-5"`; `parseGitSearch(?host=mac&commit=zz)` → `{host:"mac", …}`; the existing expectations get `host: null` in `NONE`.
- `docsHref("p", { host: "mac", path: "./a.md" })` → `"/docs/p?host=mac&path=a.md"`; parse keeps `host`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mojito/web exec vitest run test/lib/host.test.ts test/lib/git/url.test.ts test/lib/docs/url.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/host.ts`, `hooks/useHost.ts`, the codec fields and the key change**

Every existing `gitKeys`/`docKeys` caller passes `null` for now (Task 4 threads the real host); typecheck finds them.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/hooks/useHost.ts apps/web/src/components apps/web/test/lib
git commit -m "feat(web): address a host with ?host="
```

### Task 4: Git graph and docs pages for a peer

**Files:**
- Modify: `apps/web/src/hooks/useGitGraph.ts`, `apps/web/src/hooks/useDocs.ts`, `apps/web/src/components/git/GitGraphPage.tsx`, `CommitSheet.tsx`, `DiffView.tsx`, `apps/web/src/components/docs/DocsPage.tsx`, `MarkdownView.tsx`

**Interfaces:**
- Consumes: `useHost`, `hostOf`, `hostApi`, codecs with `host`, keys with `host` (Task 3).
- Produces: `useGitGraph(host, project, ticket)`, `useCommit(host, project, hash)`, `useDiff(host, project, hash, file, from)`, `useDocList(host, project, ticket, enabled?)`, `useDocFile(host, project, ticket, path)` — each URL built with `hostApi(host, …)`.

Behaviour: `GitGraphPage`/`DocsPage` call `useHost()`. `loading` → render the page frame with no query (nothing fetched); `unknown` → the page's existing error state with the text `Unknown host <name>`; `self`/`peer` → as today with `host = hostOf(r)`. Every `gitHref`/`docsHref` built on these pages (rows, commit sheet, diff back, markdown links, Back from a document, Reload's keys) passes `host`. Back to "the board" from these pages is unchanged.

- [ ] **Step 1: Thread `host` through the hooks and pages**

No new pure logic (codecs and `hostApi` are tested in Task 3); this task is glue.

- [ ] **Step 2: Verify**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Then `pnpm dev`, open `/git/<project>` and `/docs/<project>` (no host) — unchanged; `/git/<project>?host=nope` → "Unknown host nope", no `/api/peers/nope/…` request in the network panel.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks apps/web/src/components/git apps/web/src/components/docs
git commit -m "feat(web): git graph and docs of a peer's project"
```

### Task 5: Terminal page for a peer session

**Files:**
- Create: `apps/web/src/lib/peerSession.ts`
- Modify: `apps/web/src/components/terminal/TerminalPage.tsx`, `TerminalView.tsx`, `ImageViewer.tsx`, `apps/web/src/lib/terminal/imageInput.ts`
- Test: `apps/web/test/lib/peerSession.test.ts`, `apps/web/test/lib/terminal/imageInput.test.ts` (if it covers `uploadImages`' url)

**Interfaces:**
- Consumes: `useHost`, `hostOf`, `hostApi`, `ptyPath`, `gitHref`/`docsHref` with `host` (Task 3).
- Produces:
  - `peerSessionView(peer: PeerSnapshot, id: string, lastKnown: SessionMeta | null): { session: SessionMeta | null; offline: boolean }` — `session` = the snapshot's row for `id` ?? `lastKnown`; `offline` = `!peer.online`.
  - `exitAction(host: string | null, seen: boolean): "ended" | "board"` — local → `"ended"` (today's behaviour); peer → `"ended"` when `seen`, `"board"` otherwise.
  - `TerminalView` gains prop `host: string | null`; its socket URL is `${scheme}://${location.host}${ptyPath(host, id)}?token=…`.
  - `uploadImages(host: string | null, sessionId: string, files: File[])`; `ImageViewer` gains `host: string | null`.

Behaviour (TerminalPage): `useHost()` — `loading` → the page frame, no `TerminalView` mounted; `unknown` → `<Navigate to={boardHref()} replace />`; `self` → exactly today's code path (the list-based `Navigate` stays). `peer` → session from `peerSessionView`, `lastKnown` kept in state keyed by `host+id` (set whenever the snapshot has the row); `onExit` → `exitAction(host, lastKnown !== null)`: `"ended"` shows the existing "Session ended" panel, `"board"` navigates to `boardHref()` with replace. The ticket line of a peer session shows `ticketTitles[ticket]` (no status, no link): `Identity`'s `ticket` prop narrows to `{ title: string; statusName?: string; url?: string } | undefined`. The header shows, for a peer, a muted `on <peer>` after the identity, and `· offline` when `offline`. With no session known yet (cold load before the snapshot has it), the identity shows the id from the url. Kill, image upload, image viewer, `.md` paths and the Git/Docs buttons all carry `host`. After Kill: `boardHref()` as today (invalidate `qk.peers` instead of `qk.sessions` for a peer).

- [ ] **Step 1: Write the failing tests**

- `peerSessionView(onlinePeerWith(a), "mj-a", null).session` is `a`; `(onlinePeerWithout, "mj-a", a)` → `{ session: a, offline: false }`; `(offlinePeer, "mj-a", a)` → `{ session: a, offline: true }`; `(onlinePeerWithout, "mj-a", null)` → `{ session: null, offline: false }`.
- `exitAction(null, false)` → `"ended"`; `exitAction("mac", true)` → `"ended"`; `exitAction("mac", false)` → `"board"`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mojito/web exec vitest run test/lib/peerSession.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `lib/peerSession.ts` and wire the terminal page, view, viewer and upload**

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Local session in `pnpm dev`: unchanged (type, Kill, image paste, `.md` link).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib apps/web/src/components/terminal apps/web/test/lib
git commit -m "feat(web): a peer's session in this client's terminal"
```

### Task 6: Sidebar and ticket sheet open peer sessions in place

**Files:**
- Modify: `apps/web/src/components/sidebar/SidebarRow.tsx`, `PeerSection.tsx`, `HostSection.tsx`, `SessionSidebar.tsx`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/lib/sidebar.ts`, `apps/web/src/components/sheets/TicketSheet.tsx`, `apps/web/src/lib/peers.ts` (doc comment only)
- Test: `apps/web/test/lib/sidebar.test.ts`

**Interfaces:**
- Consumes: `sessionHref` (Task 3).
- Produces:
  - `type CurrentSession = { host: string | null; id: string }`; `isCurrent(current: CurrentSession | undefined, host: string | null, id: string): boolean` in `lib/sidebar.ts`.
  - `SidebarRow` loses `remote`, gains `to: string`; every row is a `<Link>` with today's local behaviour (`replace`, `onPick` on a plain click, `aria-current`).
  - `SessionSidebar`/`Panel` take `current?: CurrentSession` instead of `currentId`; `AppShell` builds it from `useMatch("/session/:id")` + `useSearchParams().get("host")`.
  - `PeerSection` takes the same `replace`/`onPick`/`current` the local rows get and uses `to={sessionHref(peer.name, s.id)}`.
  - `HostSection`'s `href` opens in the same tab (drop `target`/`rel`; doc comment updated).

TicketSheet: delete `openOnPeer`, the `tab` variable and the `window.open("")` in `start`; success and the 409-with-`sessionId` path both `navigate(sessionHref(peer?.name ?? null, id))` (keep `toast.success("Started on <peer>")` for a peer). `PeerLiveSession`'s button becomes a `<Link to={sessionHref(peer.name, session.id)}>` labelled `Open` (it closes the sheet like the local Open does).

- [ ] **Step 1: Write the failing test**

`isCurrent({host:null,id:"mj-a"}, null, "mj-a")` → true; `({host:"mac",id:"mj-a"}, null, "mj-a")` → false; `({host:null,id:"mj-a"}, "mac", "mj-a")` → false; `(undefined, null, "mj-a")` → false.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mojito/web exec vitest run test/lib/sidebar.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/test/lib/sidebar.test.ts
git commit -m "feat(web): peer sessions open in place; host switch in the same tab"
```

### Task 7: Board header and tab title name the host

**Files:**
- Modify: `apps/web/src/components/board/Toolbar.tsx`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/lib/peers.ts`
- Test: `apps/web/test/lib/peers.test.ts`

**Interfaces:**
- Produces: `appTitle(self: string | undefined): string` — `undefined`/`""` → `"Mojito"`, else `` `${self} · Mojito` ``.

Toolbar `<h1>`: `usePeers().data?.self || "Mojito"`. `AppShell`: an effect setting `document.title = appTitle(self)`.

- [ ] **Step 1: Write the failing test** — `appTitle(undefined)` → `"Mojito"`; `appTitle("")` → `"Mojito"`; `appTitle("ai-tonic")` → `"ai-tonic · Mojito"`.
- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @mojito/web exec vitest run test/lib/peers.test.ts` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Verify** — `pnpm test && pnpm typecheck` → PASS
- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/test/lib/peers.test.ts
git commit -m "feat(web): the board header and tab title name the host"
```

### Task 8: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (Peers paragraph in Server; "Peers in the web" in Web; `UpgradeDeps`/ws paths mention), `docs/superpowers/specs/2026-10-31-mojito-peers-design.md` (one line under "Out of scope": superseded for sessions by `2026-11-02-peer-sessions-in-place-design.md`)

CLAUDE.md must say: the allowlisted HTTP relay and its table summary, the `/ws/peers/<name>/pty/<id>` relay and its close-code rule, `?host=` (never resolved to this instance unless `self`), `hostApi` as the one way to address a host, peer rows/“Session on <peer>”/“Run on” opening in place, the band's ↗ in the same tab, the board header/tab title. Remove "Nothing else is forwarded — no pty, git, docs" and the `window.open("")` Safari note.

- [ ] **Step 1: Edit the docs**
- [ ] **Step 2: Full verification** — `pnpm test && pnpm typecheck && pnpm build` → all PASS
- [ ] **Step 3: Manual check on both machines** (after `make deploy` on each): from the box's phone client open a Mac session from the sidebar — type, rotate (resize), paste an image, tap an image path and a `.md` path, Git, Docs, Kill; launch a ticket with "Run on mac" → lands in this tab's terminal; sleep the Mac with the terminal open → "offline", wake → re-attaches; band ↗ → the Mac's client in the same tab, Back returns.
- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-31-mojito-peers-design.md
git commit -m "docs: peer sessions in place"
```
