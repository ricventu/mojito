# Peers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Mojito client shows the live sessions of every configured instance in its sidebar, can launch a ticket on another instance, and can switch to another instance's client.

**Architecture:** Each server keeps one `PeerLink` per `MOJITO_PEERS` URL: it holds the peer's `/ws/events` open, reads its sessions/projects/tickets on every connect, keeps an in-memory `PeerSnapshot`, and re-emits it on the local bus as `peers.updated`. `GET /api/peers` serves the snapshots; `POST /api/peers/:name/sessions` forwards a launch verbatim. The web reads `/api/peers`, draws peer groups in the sidebar as links to the peer's own client (`?token=` handoff, one shared token), and offers "Run on" in the ticket sheet.

**Tech Stack:** Node 22, Hono 4, `ws` 8, zod 4, vitest; React 19, TanStack Query, shadcn/ui (Radix), lucide.

**Spec:** `docs/superpowers/specs/2026-10-31-mojito-peers-design.md`

## Global Constraints

- Everything in English (code, comments, copy, log lines).
- One `MOJITO_TOKEN` for all instances; no peer token config, no secret other than that token reaches a browser.
- Peer project **paths never leave the peer**: a snapshot carries project names only.
- Nothing but the launch is forwarded (no pty, git, docs, settings, hide, kill).
- Peer reads: 10 s each. Forwarded launch: 30 s. Event-socket backoff: the existing `retryDelay` (1 s → 15 s).
- Error bodies are `{ error }`. Offline/refused/non-json peer → 502 `{error: "<name> is not reachable"}`; timeout → 504 `{error: "<name> did not answer within 30 s: the session may still be starting"}`.
- Web: pure logic in `src/lib`, tested in node; Tailwind utilities + shadcn components; lucide icons with `size`.
- Never touch real tmux sessions in tests.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A peer URL that is an IP or a bare host** (`http://127.0.0.1:3200`, `http://localhost:3200` — the dev setup): its name is the whole hostname, not `127`. Pinned in Task 2.
2. **A trailing slash or path in `MOJITO_PEERS`** (`https://mac.x.ts.net/`): the stored url has no trailing slash, so `peerHref` and the link never build `//api`. Pinned in Task 2.
3. **A peer that rejects the token (401)** — the instances' tokens differ: the peer stays offline, and the log says the token was rejected rather than a generic failure. Pinned in Task 4.
4. **A peer session ending** (`session.updated` with `state: "ended"`): it leaves the snapshot at once, it does not linger as an `ended` row. Pinned in Task 4.
5. **A peer down when this server boots**: boot is never delayed or failed by it; the link just retries. Pinned in Task 4 (`start()` returns synchronously; a failing dial schedules a retry).

---

## File Structure

**Shared** (`packages/shared/src`)
- `eventStream.ts` (moved from web) — `openEventStream`, `retryDelay`, `EventSocket`, `Schedule`; `schedule` is a **required** parameter (the shared lib has no timer typings).
- `types.ts` — `PeerSnapshot`, `PeersAnswer`.
- `events.ts` — `projects.changed`, `peers.updated`.

**Server** (`apps/server/src`)
- `config.ts` — `name`, `peers: PeerConfig[]`, `parsePeers`.
- `peers/link.ts` — `PeerLink` (one peer's socket, reads and snapshot).
- `peers/forward.ts` — `forwardLaunch` (the one forwarded request).
- `peers/registry.ts` — `PeerRegistry` (the links, by name; what routes see).
- `http/routes/peers.ts` — `GET /peers`, `POST /peers/:name/sessions`.
- `http/routes/projects.ts` — emits `projects.changed`.
- `main.ts` — builds and starts the registry, stops it on shutdown.

**Web** (`apps/web/src`)
- `lib/eventStream.ts` — re-exports shared, supplies the browser's default `schedule`.
- `lib/peers.ts` — `peerHref`, `launchHosts`, `waitingPeers`, `replacePeer`.
- `lib/queryKeys.ts` — `qk.peers`.
- `hooks/usePeers.ts`; `hooks/useEvents.ts` handles the two new events.
- `lib/sidebar.ts` — parameter types loosened so peer data fits.
- `components/sidebar/PeerSection.tsx`, `InstanceSwitcher.tsx`; `SessionSidebar.tsx`, `SidebarRow.tsx`, `SidebarToggle.tsx` changed.
- `components/ui/dropdown-menu.tsx` — shadcn's.
- `components/sheets/TicketSheet.tsx` — "Run on".

---

### Task 1: Shared contract and the event stream in shared

**Files:**
- Create: `packages/shared/src/eventStream.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/types.ts`, `packages/shared/src/events.ts`
- Modify: `apps/web/src/lib/eventStream.ts` (becomes a re-export + default schedule)
- Test: `apps/web/test/lib/eventStream.test.ts` (unchanged — must still pass)

**Interfaces:**
- Produces (shared):
  ```ts
  export interface PeerSnapshot {
    name: string; url: string; online: boolean;
    sessions: SessionMeta[];            // non-ended only
    projects: string[];                 // names only
    ticketTitles: Record<string, string>; // only tickets of `sessions`
  }
  export interface PeersAnswer { self: string; peers: PeerSnapshot[] }
  // MojitoEvent gains:
  | { type: "projects.changed" }
  | { type: "peers.updated"; peer: PeerSnapshot }
  // eventStream.ts (moved verbatim except the signature):
  export function openEventStream(connect: () => EventSocket, handlers: EventStreamHandlers, schedule: Schedule): () => void;
  export { retryDelay, EVENT_RETRY_MS, EVENT_RETRY_MAX_MS, type EventSocket, type EventStreamHandlers, type Schedule };
  ```
- Produces (web): `apps/web/src/lib/eventStream.ts` exports the same names, with `openEventStream(connect, handlers, schedule = defaultSchedule)` wrapping shared's.

- [ ] **Step 1:** Move the body of `apps/web/src/lib/eventStream.ts` to `packages/shared/src/eventStream.ts`, minus `defaultSchedule`; make `schedule` required. Export it from `index.ts`. Its doc comments move with it.
- [ ] **Step 2:** Rewrite `apps/web/src/lib/eventStream.ts` as: the re-exports, `defaultSchedule` (the `setTimeout` one), and an `openEventStream` that passes it as the default.
- [ ] **Step 3:** Add `PeerSnapshot`, `PeersAnswer` to `types.ts` and the two event variants to `events.ts`, each with a one-line doc comment from the spec.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck` from the repo root. Expected: all green (`eventStream.test.ts` passes through the re-export; `useEvents`' `switch` still compiles — the new events fall through until Task 6).
- [ ] **Step 5:** Commit `refactor: the event stream moves to shared; peer types and events`.

---

### Task 2: Configuration — `MOJITO_NAME`, `MOJITO_PEERS`

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/test/config.test.ts`, `apps/server/test/http/setup.ts` (`cfg` gains `name: "box", peers: []`)

**Interfaces:**
- Produces:
  ```ts
  export interface PeerConfig { name: string; url: string } // url: origin + path, no trailing slash
  export function parsePeers(raw: string | undefined): PeerConfig[]; // throws Error on a bad list
  // ServerConfig gains: name: string; peers: PeerConfig[]
  export function loadConfig(env?: NodeJS.ProcessEnv, osHostname?: string): ServerConfig; // osHostname defaults to os.hostname()
  ```

- [ ] **Step 1: Write the failing tests** in `config.test.ts`:
  ```ts
  describe("parsePeers", () => {
    it("is empty for unset or blank", () => {
      expect(parsePeers(undefined)).toEqual([]);
      expect(parsePeers(" , ")).toEqual([]);
    });
    it("names a peer by the first label of its host and drops a trailing slash", () => {
      expect(parsePeers("https://mac.tail1.ts.net/, https://ai-tonic.tail1.ts.net")).toEqual([
        { name: "mac", url: "https://mac.tail1.ts.net" },
        { name: "ai-tonic", url: "https://ai-tonic.tail1.ts.net" },
      ]);
    });
    it("names an IP or a dotless host by the whole hostname", () => {
      expect(parsePeers("http://127.0.0.1:3200,http://localhost:3300,http://[::1]:3400").map((p) => p.name))
        .toEqual(["127.0.0.1", "localhost", "[::1]"]);
    });
    it("refuses a duplicate name", () => {
      expect(() => parsePeers("https://mac.a.ts.net,https://mac.b.ts.net")).toThrow(/duplicate peer name: mac/);
    });
    it("refuses what is not an http(s) URL", () => {
      expect(() => parsePeers("ftp://mac.a.ts.net")).toThrow(/MOJITO_PEERS/);
      expect(() => parsePeers("mac.a.ts.net")).toThrow(/MOJITO_PEERS/);
    });
  });
  it("MOJITO_NAME, else the hostname up to its first dot", () => {
    expect(loadConfig(KEYS, "ai-tonic.local").name).toBe("ai-tonic");
    expect(loadConfig({ ...KEYS, MOJITO_NAME: "box" }, "ai-tonic.local").name).toBe("box");
  });
  ```
  Update "applies the defaults" to pass `"ai-tonic"` as `osHostname` and expect `name: "ai-tonic", peers: []`.
- [ ] **Step 2:** Run `pnpm --filter @mojito/server test config`. Expected: FAIL (`parsePeers` is not exported).
- [ ] **Step 3:** Implement `parsePeers` (split on `,`, trim, drop empties; `new URL`, protocol `http:`/`https:` else `MOJITO_PEERS: not an http(s) URL: <item>`; name = `url.hostname` when it is an IP literal (`net.isIP` on the unbracketed form) or has no dot, else its first label; url = `origin + pathname` with trailing `/` stripped) and wire `name`/`peers` into `loadConfig`.
- [ ] **Step 4:** Run `pnpm --filter @mojito/server test && pnpm --filter @mojito/server typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): MOJITO_NAME and MOJITO_PEERS`.

---

### Task 3: `projects.changed`

**Files:**
- Modify: `apps/server/src/http/routes/projects.ts` (in `changed()`)
- Modify: `apps/web/src/hooks/useEvents.ts` (`case "projects.changed"`: invalidate `qk.projects`)
- Test: `apps/server/test/http/projects.test.ts`

- [ ] **Step 1: Write the failing tests:** after a successful POST, PUT (same name and rename) and DELETE, `events` contains `{ type: "projects.changed" }`; after a refused POST (relative path) and a 404 DELETE it does not.
- [ ] **Step 2:** Run `pnpm --filter @mojito/server test projects`. Expected: FAIL on the emits.
- [ ] **Step 3:** `changed()` also does `deps.bus.emit({ type: "projects.changed" })`; add the web case.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: projects.changed — a project edit shows on every device`.

---

### Task 4: `PeerLink`

**Files:**
- Create: `apps/server/src/peers/link.ts`
- Test: `apps/server/test/peers/link.test.ts`

**Interfaces:**
- Consumes: `PeerConfig` (Task 2); `openEventStream`, `EventSocket`, `Schedule`, `PeerSnapshot` (Task 1); `EventBus`.
- Produces:
  ```ts
  export interface PeerLinkDeps {
    peer: PeerConfig;
    token: string;
    bus: EventBus;
    fetch?: typeof fetch;                         // default globalThis.fetch
    connect?: (url: string) => EventSocket;       // default: a `ws` WebSocket wrapper
    schedule?: Schedule;                          // default: setTimeout
    readTimeoutMs?: number;                       // default 10_000
  }
  export class PeerLink {
    constructor(deps: PeerLinkDeps);
    readonly peer: PeerConfig;
    start(): void;          // synchronous: dials, never awaits
    stop(): void;           // disposes the stream; no more retries
    snapshot(): PeerSnapshot;
  }
  ```
  The socket URL is `peer.url` with `http`→`ws` + `/ws/events?token=<encoded token>`. Reads go to `<url>/api/sessions|projects|tickets` with `x-mojito-token` and `AbortSignal.timeout(readTimeoutMs)`. `projects` is `ProjectRow[]` → names; `tickets` is `BoardTickets` → `identifier → title`.

  Behaviour (each line is a test):
  - open → the three reads → `online: true`, sessions without `ended`, project names, `ticketTitles` only for tickets of those sessions; exactly one `peers.updated` carrying that snapshot.
  - `session.updated` adds/replaces a row; one with `state: "ended"` removes it; `session.removed` removes it; each emits `peers.updated`.
  - `tickets.changed` re-reads tickets; `projects.changed` re-reads projects; `settings.updated`/`task.updated` change nothing and emit nothing.
  - a read failing (reject, non-2xx, timeout) closes the socket and leaves `online: false`; a 401 logs `"<name>: token rejected (401)"` via `console.error`, any other failure logs `"<name>: <message>"`.
  - close → `online: false`, `sessions: []`, `ticketTitles: {}`, one `peers.updated` (none if it was already offline and empty); a retry is scheduled.
  - `start()` returns before any read resolves; a `connect` that throws counts as a close (retry scheduled, nothing thrown out of `start`).
  - `stop()` → no further dial after the scheduled retry fires.

- [ ] **Step 1: Write the failing tests** above with a fake socket (as in `apps/web/test/lib/eventStream.test.ts`), a `vi.fn` fetch answering `Response` objects per path, and a collecting `schedule`. Snapshot assertion for the open case:
  ```ts
  expect(link.snapshot()).toEqual({
    name: "mac", url: "https://mac.t.ts.net", online: true,
    sessions: [running],                         // the ended one from /api/sessions is dropped
    projects: ["Ios"],
    ticketTitles: { "RIC-7": "Ship it" },       // RIC-8 has no session: left out
  });
  ```
- [ ] **Step 2:** Run `pnpm --filter @mojito/server test peers/link`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `PeerLink`. Events patch the current snapshot even while the reads are in flight; the reads, when they land, replace it — the same accepted race the web client has.
- [ ] **Step 4:** Run `pnpm --filter @mojito/server test && pnpm --filter @mojito/server typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(server): PeerLink — a peer's sessions, kept live`.

---

### Task 5: Registry, forwarding, routes, boot

**Files:**
- Create: `apps/server/src/peers/forward.ts`, `apps/server/src/peers/registry.ts`, `apps/server/src/http/routes/peers.ts`
- Modify: `apps/server/src/http/app.ts` (`AppDeps.peers?: PeerRegistry`; mount `peerRoutes`), `apps/server/src/main.ts`
- Test: `apps/server/test/http/peers.test.ts`, `apps/server/test/peers/forward.test.ts`

**Interfaces:**
- Consumes: `PeerLink` (Task 4), `PeerConfig` (Task 2), `LaunchBody`, `PeersAnswer`.
- Produces:
  ```ts
  // forward.ts
  export type ForwardResult = { status: number; body: unknown } | { status: 502 | 504; body: { error: string } };
  export function forwardLaunch(
    peer: PeerConfig, token: string, body: LaunchBody,
    opts?: { fetch?: typeof fetch; timeoutMs?: number },   // timeoutMs default 30_000
  ): Promise<ForwardResult>;
  // registry.ts
  export class PeerRegistry {
    constructor(self: string, links: PeerLink[]);
    readonly self: string;
    answer(): PeersAnswer;                 // peers in configuration order
    config(name: string): PeerConfig | undefined;
    online(name: string): boolean;
    start(): void; stop(): void;
  }
  ```
- Routes: with no `deps.peers`, `GET /api/peers` → `{ self: deps.cfg.name, peers: [] }` and every `POST /api/peers/:name/sessions` → 404.

- [ ] **Step 1: Write the failing tests.**
  `forward.test.ts` (fetch stubbed): 201 body passes through verbatim with status; 409 `{error, sessionId}` passes through; a peer 400 passes through; the request is `POST <url>/api/sessions` with `x-mojito-token` and `content-type: application/json`; fetch rejecting → `{status: 502, body: {error: "mac is not reachable"}}`; a non-json 200 → 502; a fetch honouring `signal` that never answers with `timeoutMs: 20` → `{status: 504, body: {error: "mac did not answer within 30 s: the session may still be starting"}}` (the message keeps "30 s" — it names the production limit).
  `peers.test.ts` (via `setup({ peers })`, a registry over stub links exposing fixed snapshots, `forwardLaunch` injected or fetch stubbed): `GET /api/peers` answers `{self, peers}`; without a registry `{self: "box", peers: []}`; POST to an unknown name → 404 `{error: "peer not found: x"}`; an invalid body → 400 and no fetch; an offline peer → 502 without fetching; an online one → the forwarded status/body.
- [ ] **Step 2:** Run `pnpm --filter @mojito/server test peers`. Expected: FAIL.
- [ ] **Step 3:** Implement `forward.ts`, `registry.ts`, `routes/peers.ts`; mount in `app.ts`. In `main.ts`: `const peers = new PeerRegistry(cfg.name, cfg.peers.map((peer) => new PeerLink({ peer, token: cfg.token, bus })))`, pass to `createApp`, `peers.start()` after `listen`'s callback is registered, `peers.stop()` first thing in `shutdown`. Log `peers: mac, …` at boot when any.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS, and `apps/server/dist/main.js` built.
- [ ] **Step 5:** Commit `feat(server): /api/peers and launching on a peer`.

---

### Task 6: Web data — `lib/peers.ts`, `usePeers`, events

**Files:**
- Create: `apps/web/src/lib/peers.ts`, `apps/web/src/hooks/usePeers.ts`
- Modify: `apps/web/src/lib/queryKeys.ts` (`peers: ["peers"]`), `apps/web/src/hooks/useEvents.ts`
- Test: `apps/web/test/lib/peers.test.ts`

**Interfaces:**
- Consumes: `PeerSnapshot`, `PeersAnswer`, `TicketSummary` (Task 1).
- Produces:
  ```ts
  export function peerHref(peer: Pick<PeerSnapshot, "url">, path: string, token: string): string;
  export interface LaunchHost { name: string; peer: PeerSnapshot | null } // null = this instance
  export function launchHosts(ticket: Pick<TicketSummary, "project">, self: string, peers: PeerSnapshot[]): LaunchHost[];
  export function waitingPeers(peers: PeerSnapshot[]): boolean;
  export function replacePeer(answer: PeersAnswer | undefined, peer: PeerSnapshot): PeersAnswer | undefined;
  export function usePeers(): UseQueryResult<PeersAnswer>; // GET /api/peers under qk.peers
  ```

- [ ] **Step 1: Write the failing tests:**
  ```ts
  expect(peerHref({ url: "https://mac.t.ts.net" }, "/session/mj-RIC-7", "a+b=")).toBe(
    "https://mac.t.ts.net/session/mj-RIC-7?token=a%2Bb%3D");
  expect(peerHref({ url: "https://mac.t.ts.net" }, "/", "t")).toBe("https://mac.t.ts.net/?token=t");
  // launchHosts: self first; online peers mapping the project, in order; offline and non-mapping left out
  expect(launchHosts({ project: "Web" }, "box", [mac(["Web"]), off(["Web"]), ios(["Ios"])]).map((h) => h.name))
    .toEqual(["box", "mac"]);
  expect(launchHosts({ project: null }, "box", [mac(["Web"])]).map((h) => h.name)).toEqual(["box"]);
  // waitingPeers: true for a visible needs-input row; false when that row is hidden or the peer has none
  // replacePeer: replaces by name keeping order; an unknown name and an undefined answer are returned unchanged
  ```
- [ ] **Step 2:** Run `pnpm --filter @mojito/web test peers`. Expected: FAIL.
- [ ] **Step 3:** Implement `lib/peers.ts`, `usePeers`, `qk.peers`; `useEvents`: `case "peers.updated": qc.setQueryData<PeersAnswer>(qk.peers, (a) => replacePeer(a, e.peer))`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): peers data`.

---

### Task 7: Sidebar — peer sections, instance switcher, waiting dot

**Files:**
- Create: `apps/web/src/components/sidebar/PeerSection.tsx`, `apps/web/src/components/sidebar/InstanceSwitcher.tsx`, `apps/web/src/components/ui/dropdown-menu.tsx` (`pnpm dlx shadcn@latest add dropdown-menu` in `apps/web`)
- Modify: `apps/web/src/lib/sidebar.ts`, `components/sidebar/SessionSidebar.tsx`, `SidebarRow.tsx`, `SidebarToggle.tsx`
- Test: `apps/web/test/lib/sidebar.test.ts` (one added case)

**Interfaces:**
- Consumes: `usePeers`, `peerHref`, `waitingPeers` (Task 6); `getToken`.
- Changes:
  - `sidebarGroups(projects: Pick<ProjectRow, "name">[], sessions)` and `sessionLabel(s, tickets: Pick<TicketSummary, "identifier" | "title">[])` — types loosened only; a peer calls them with `peer.projects.map((name) => ({ name }))` and `Object.entries(peer.ticketTitles).map(([identifier, title]) => ({ identifier, title }))`.
  - `SidebarRow` gains `href?: string`: when set it renders `<a href target="_blank" rel="noopener">` instead of `<Link>`, and no eye button (`onHide` becomes optional; `replace`/`onPick` ignored for it).
  - `PeerSection({ peer, hidden: boolean })` — heading `name` + dot (`bg-emerald-500` online / `bg-muted-foreground/40` + "offline" text), then its groups (`shown` or `hidden` half of `splitHidden`) under sub-headings `project ?? "General"`. An offline peer renders the heading only, and only in the shown half.
  - `InstanceSwitcher()` — renders nothing when `peers` is empty; otherwise a `DropdownMenu` whose trigger is `self` + `ChevronDown` (size 14) replacing the "Sessions" title text's position (title stays for screen readers: `SheetTitle`/`h2` keeps "Sessions", visually `sr-only` when the switcher shows), items = peers with their dot, each an `<a href={peerHref(peer, "/", token)} target="_blank" rel="noopener">`; an offline one is still listed.
  - `SessionSidebar`: after the local `groupList(shown)`, one `PeerSection` per peer; the hidden footer counts local + peer hidden rows, `hiddenWaiting` includes peer hidden `needs-input` rows, and the expanded hidden list renders peers' hidden halves after the local one.
  - `SidebarToggle`: a `size-2 rounded-full bg-amber-500` dot at the icon's corner when `waitingPeers(peers)`, with `aria-label="Sessions — a session on another instance needs you"` then.

- [ ] **Step 1: Write the failing test:** `sidebarGroups([{ name: "Ios" }], [session("mj-RIC-7", { project: "Ios" })])` groups under `"Ios"` and `sessionLabel(session("mj-RIC-7", { kind: "ticket", ticket: "RIC-7" }), [{ identifier: "RIC-7", title: "Ship it" }])` → `{ primary: "RIC-7", secondary: "Ship it" }` — both compile only with the loosened types.
- [ ] **Step 2:** Run `pnpm --filter @mojito/web typecheck`. Expected: FAIL (type errors in the test).
- [ ] **Step 3:** Loosen the types; add the dropdown component; build `PeerSection`, `InstanceSwitcher`; wire `SessionSidebar`, `SidebarRow`, `SidebarToggle`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS (`safeArea.test.ts` included — no new edge surface).
- [ ] **Step 5:** Commit `feat(web): other instances' sessions in the sidebar, and a switcher`.

---

### Task 8: "Run on" in the ticket sheet

**Files:**
- Modify: `apps/web/src/components/sheets/TicketSheet.tsx` (`LaunchForm`)

**Interfaces:**
- Consumes: `usePeers`, `launchHosts`, `peerHref`, `LaunchHost` (Task 6); `launchErrorAction`; `POST /api/peers/:name/sessions` (Task 5).

- [ ] **Step 1:** In `LaunchForm`: `const hosts = launchHosts(ticket, peers.data?.self ?? "", peers.data?.peers ?? [])`; state `host: string` (default `hosts[0].name`; if the picked peer drops out of `hosts`, fall back to it). With `hosts.length > 1`, a "Run on" `Select` (`id="ticket-host"`, label "Run on") above `LaunchOptions`, items = host names, the first suffixed " (this one)".
- [ ] **Step 2:** The peer path of the mutation: on click, before `mutate`, `const tab = window.open("", "_blank")` (then `tab.opener = null`); the mutation posts the same body to `/api/peers/${encodeURIComponent(name)}/sessions`. Success: `tab.location.href = peerHref(peer, sessionPath(session.id), getToken())`, `toast.success(\`Started on ${name}\`)`, a `warning` toasted as now, `onClose()`; no navigation. `launchErrorAction` → `open`: point the tab at that session, `onClose()`; `toast`: `tab.close()` and toast the message. A null `tab` (blocked) → after success, `toast.success` gets an action "Open" doing `window.open(href, "_blank", "noopener")`. The local path is unchanged.
- [ ] **Step 3:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 4: Verify by hand** with two dev servers: in one shell `pnpm --filter @mojito/server dev` with `MOJITO_PEERS=http://127.0.0.1:3200 MOJITO_NAME=a`; in another `MOJITO_PORT=3200 MOJITO_STATE_DIR=$HOME/.local/state/mojito-dev2 MOJITO_NAME=b MOJITO_PEERS=http://127.0.0.1:3100 pnpm --filter @mojito/server exec tsx src/main.ts`; `pnpm --filter @mojito/web dev`. Map the same project on both. Check: B's sessions show under "b" in A's sidebar; a row opens B's client in a new tab logged in; stopping B turns "b" offline with no rows within a second, restarting it brings them back within 15 s; the ticket sheet shows "Run on" with a and b, and launching on b opens b's terminal; the switcher opens b.
- [ ] **Step 5:** Commit `feat(web): Run on — launch a ticket on another instance`.

---

### Task 9: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Add `MOJITO_NAME`, `MOJITO_PEERS` to the env vars in the intro; add `PeerSnapshot`, `PeersAnswer` to the shared list; a **Peers** bullet under Server (config and the shared-token decision, `PeerLink` behaviour — empties on close, no echo, `projects.changed` —, the two routes and their 502/504); a **Peers** bullet under Web (sidebar peer sections as `<a>` with the `?token=` handoff, no Hide, the toggle's dot, the switcher, "Run on" and its pre-opened tab); the Mac's setup: `tailscale serve --bg 8700`, the same `MOJITO_TOKEN`, each instance listing the other in `MOJITO_PEERS`.
- [ ] **Step 2:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 3:** Commit `docs: peers in CLAUDE.md`.
