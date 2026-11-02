# Peers: every instance's sessions in one client

Mojito runs on more than one machine — the Linux box and the Mac — each with its own tmux,
database, projects and ticket cache. Today a session on the Mac is invisible from the box's
client and the other way round. This makes every client show the sessions of every instance,
says where each one runs, and lets a ticket be launched on another instance.

Decided with the owner on 2026-10-31:

- **In scope:** every instance's live sessions in the sidebar of every client, with their
  host; a "Run on" choice when launching a ticket; a menu to switch to another instance.
- **Out of scope:** everything else stays in each instance's own client — terminals, Hide,
  Kill, Pull/Push, git graph, docs, Settings, prompts, create-ticket, free sessions.
  Tapping a remote session opens that instance's client at it; nothing relays a pty.
  *Superseded for sessions by `2026-11-02-peer-sessions-in-place-design.md`: a peer's session
  opens in this client, through a relay.*
- Both machines are on the tailnet and each serves its Mojito over `tailscale serve`, so each
  has an https URL the other and the phone reach.
- Projects are mostly disjoint between machines: a project lives on one host. One that is
  mapped on several makes "Run on" offer a choice.

## Configuration

`.env.local`, no Settings UI — this is machine setup, done once:

- `MOJITO_PEERS` — the other instances' URLs, comma-separated
  (`https://mac.<tailnet>.ts.net`). Unset or empty: no peers, and nothing below shows.
- `MOJITO_NAME` — this instance's name in the switcher; default the hostname up to its first
  dot. Set it to the tailnet machine name so every client calls a machine the same thing.
- A peer's **name** is the first DNS label of its URL (`mac`) — the routing key in
  `/api/peers/:name`, known at boot with no request. Two peers with the same name, or a URL
  that is not http(s), fail `loadConfig` (exit 1, like any bad config).
- **One `MOJITO_TOKEN` for every instance.** The setup is symmetric — each instance would
  hold the other's token anyway, so separate tokens add configuration and no safety. It is
  also what lets the client open a peer through the existing `?token=` first-visit handoff
  with the token it already holds: no other secret ever reaches a browser.

## Server

### Peer link (`peers/link.ts`)

One per configured peer, started at boot after `listen`, stopped on shutdown.

- Keeps the peer's `/ws/events?token=` dialled with `openEventStream` (moved from
  `apps/web/src/lib/eventStream.ts` to `@mojito/shared`: it is DOM-free and already takes its
  socket and clock injected; Node 22's global `WebSocket` is the server's socket). Same
  backoff, 1 s → 15 s: a sleeping Mac is retried every 15 s.
- On every open: `GET /api/sessions`, `GET /api/projects`, `GET /api/tickets` with
  `x-mojito-token`, 10 s each. Only when all three answer is the peer `online`; a failure
  closes the socket and the backoff retries.
- Then the peer's events patch the snapshot: `session.updated` replaces or adds the row,
  `session.removed` drops it, `tickets.changed` re-reads tickets, `projects.changed` (new,
  below) re-reads projects. Other events are ignored.
- A close sets `online: false` and **empties** `sessions`: last-known states of a machine
  that went to sleep would lie.
- Every change to a snapshot emits `peers.updated` on this instance's bus.

The snapshot (`PeerSnapshot` in shared):

```ts
interface PeerSnapshot {
  name: string;            // from the URL
  url: string;             // as configured, no trailing slash
  online: boolean;
  sessions: SessionMeta[]; // the peer's non-ended sessions
  projects: string[];      // the peer's mapped project names (paths never leave the peer)
  ticketTitles: Record<string, string>; // ticket → title, only for tickets of `sessions`
}
```

No loops: a peer's `/api/sessions` answers only its own rows, so two instances that list each
other never echo one another's sessions.

### `projects.changed`

Project edits emit nothing today. `projectRoutes` emits `{ type: "projects.changed" }` after
every successful create, update and delete; the web invalidates `qk.projects` on it (a project
edited on one device shows on another), and peer links re-read the list.

### Routes

- `GET /api/peers` → `{ self: string, peers: PeerSnapshot[] }`: `self` is `MOJITO_NAME`, the
  peers in configuration order (`[]` with none).
- `POST /api/peers/:name/sessions` — the body is a `LaunchBody`, validated here too (a bad one
  is a 400 before any request). Forwarded to the peer's `POST /api/sessions` with the token;
  the peer's status and json body are answered **verbatim** (201 `{session, warning?}`, 409
  `{error, sessionId?}`, 4xx `{error}`): the peer runs its own launch — its ticket cache, its
  prompts, its Linear writes. Unknown name → 404. Peer offline, refusing, or an answer that is
  not json → 502 `{error: "<name> is not reachable"}`. No answer within 30 s → 504
  `{error: "<name> did not answer within 30 s: the session may still be starting"}` — a slow
  Linear write is not a failed launch, and the session shows up through the link if it started.

Nothing else is forwarded.

## Web

### Data

`usePeers()` — `GET /api/peers` under `qk.peers` (a `qk` value: refetched on every events
reconnect like the rest); `peers.updated` (`{ type: "peers.updated"; peer: PeerSnapshot }`) replaces that peer's
entry in the cache's `peers`.

`lib/peers.ts`, pure and unit-tested:

- `peerHref(peer, path, token)` — `<url><path>?token=<token>`, encoded: the link every peer
  entry point uses. `path` is `/` or `/session/<id>`.
- `launchHosts(ticket, localName, peers)` — this instance first, then every **online** peer
  whose `projects` contain the ticket's project.
- `waitingPeers(peers)` — whether any peer session is `needs-input` and not hidden.

### Sidebar

- Local groups as today. Then, per peer, a heading — its name and a dot (green online, grey
  offline, "offline" spelled out) — and its sessions grouped by `sidebarGroups` over the peer's
  project names, General last. An offline peer is the heading alone.
- A peer row is `SidebarRow` rendered as `<a href={peerHref(…)} target="_blank"
  rel="noopener">`: the peer's own client opens at the session in a new tab (on the phone's
  home-screen app, a browser view closed to come back). Its label uses the peer's
  `ticketTitles`. **No Hide button**: hidden is that instance's state, changed in its client.
- A row the peer has hidden goes into this client's "Hidden (n)" footer, under its peer's
  heading; `hiddenWaiting` counts peer rows too.
- `SidebarToggle` carries an amber dot when `waitingPeers` — a Mac session asking for input is
  visible from the box with the sidebar closed.
- Board, toolbar "waiting" pill and loose rows stay local.

### Instance switcher

In the sidebar header (on every page): this instance's name (`self` from `/api/peers`) as a
dropdown listing the peers with their dot; picking one opens `peerHref(peer,
"/")` in a new tab. No peers: no menu, the header is unchanged.

### "Run on" in the ticket sheet

- `launchHosts` with one host: the sheet is unchanged.
- More: a "Run on" select beside model/effort, default this instance.
- A peer launch posts the same body to `/api/peers/:name/sessions`. 201 → the peer's terminal
  in a new tab (`peerHref(peer, sessionPath(id))`) and a toast "Started on <name>", the sheet
  stays on the board; a warning in the answer is toasted as for a local launch. 409 with
  `sessionId` → `launchErrorAction`, opening the peer's terminal instead of navigating. Any
  other error → its `{error}` in a toast.
- The window for the new tab is opened synchronously in the click (`window.open` with no URL)
  and pointed at the session once the answer arrives — Safari blocks a `window.open` after an
  `await`. A failed launch closes it.

## Tests

Server (vitest, no network):

- `loadConfig`: `MOJITO_PEERS` parsing (empty, several, trailing slash, duplicate name, non-http
  URL), `MOJITO_NAME` default.
- `peers/link.ts` with a fake socket, fake fetch and the injected schedule: open → three reads →
  `online` snapshot and one `peers.updated`; each event kind patches it; a read failing keeps it
  offline and retries; close → offline with no sessions; `stop` ends the retry loop.
- Peers routes against a fake peer (a local Hono app behind a fetch stub): status and body pass
  through for 201/409/400; unknown name 404; invalid body 400 with no request sent; refused 502;
  timeout 504.
- `projectRoutes` emits `projects.changed` on create, update, delete, and not on a failure.

Web (node, `src/lib`):

- `peerHref` encoding (id with odd characters, token with `+`/`=`).
- `launchHosts`: local only; a matching online peer; an offline one left out; order.
- Sidebar: peer groups, hidden peer rows into the footer, `waitingPeers` ignoring hidden rows.

## Docs

`CLAUDE.md` gains a **Peers** entry (server: config, link, routes, the shared-token decision;
web: sidebar, switcher, Run on), `MOJITO_PEERS`/`MOJITO_NAME` join the env vars in the intro,
and `projects.changed`/`peers.updated` join `MojitoEvent`. The Mac's setup — `tailscale serve`
for 8700, the same `MOJITO_TOKEN`, each instance listing the other — is written in the entry.
