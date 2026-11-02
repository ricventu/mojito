# Peer sessions in place

Today a session on another instance (a peer, see `2026-10-31-mojito-peers-design.md`) opens
that instance's own client in a **new tab**. With two machines and a few sessions that is many
tabs and no clear sense of which tab is which machine. This change opens a peer's session
**in this client, on this origin**, exactly like a local one, and keeps the peer's own client
one tap away, in the same tab, for what belongs to the machine.

Decided with the owner on 2026-11-02:

- A peer's session behaves **like a local session**: terminal, image paste/drop/picker, the
  image viewer, `.md` paths into the docs viewer, the terminal header's Git and Docs buttons,
  Kill. Same sidebar, same header, Back to the board.
- The peer's band keeps its **↗ to the peer's own client** — that is how one switches host to
  use the machine's actions (Pull/Push, launches, its board, Settings). It now opens in the
  **same tab**, not a new one.

This reverses the peers spec's "nothing relays a pty": its reason (keep the first version
small) is gone; its constraints (paths never leave a peer, one shared token, no echo) stand.

## Goals

- No new tab for anything session-shaped on a peer: a sidebar row, the ticket sheet's
  "Session on <peer>", a "Run on" launch.
- The browser talks only to this instance. It never needs to reach a peer's URL for a
  session (the phone may reach this instance and not the Mac's), never needs CORS, never
  holds anything but the token it already has.
- A peer that sleeps or drops mid-session reads as "offline" in the terminal and reconnects
  when it is back — it never throws the reader to the board.

## Non-goals

- The peer's **board, project actions and settings** in this client: Pull/Push, New session,
  create-ticket, Settings, the project-header git graph/docs entries. Those are the band's ↗.
- The board showing peer tickets or sessions (the board stays local, as today).
- Launching **free** sessions on a peer (unchanged: "Run on" is for tickets).
- Removing a peer's ended session (`DELETE …?remove=1`): the sidebar never shows ended peer
  sessions, so there is nothing to tap.

## Anti-goals

- A generic open proxy to the peer's API. Only the routes listed below pass; anything else is
  a 404 from this instance, so a bug in the client cannot write a peer's settings or fire its
  hook endpoint.
- A peer session that silently becomes a local one (or another peer's) because two instances
  have a session with the same id. Ids are unique per instance only — `mj-<slug>-git` exists
  on every instance mapping that project. The host is always part of the address.
- A terminal that reconnect-loops forever on a session the peer says is gone (4404 must
  reach the browser as 4404).

## Addressing: `?host=`

Every page that can show a peer's thing takes `host=<peer name>`; absent means this instance.

- `/session/:id?host=mac`
- `/git/:project?host=mac&…`, `/docs/:project?host=mac&…`

A query parameter, not a path prefix: the routes, the AppShell layout and the sidebar logic
stay as they are, and the git/docs url codecs (`lib/git/url.ts`, `lib/docs/url.ts`) gain one
field. The codecs keep `host` as written; they never decide what it names. Every in-page
navigation on those pages (commit sheet, diff, doc → doc, Back) **keeps** `host`.

**A `host` is never read as this instance** (my call, from the anti-goal: a renamed peer's
old url, `/session/mj-mojito-git?host=192.168.1.5`, must not open — and Kill — the local
`mj-mojito-git`). A page with `host` waits for `/api/peers` before it fetches, renders the
session or dials the terminal; then `host` equal to `self` is this instance, a configured
peer is that peer, and anything else is "not found" — the session page goes to the board
(as a missing local session does), the git/docs pages show their error state with
"unknown host <name>". This applies to `/session/:id` as much as to git and docs.

## Server

### HTTP relay: `/api/peers/:name/…`

One route family in `http/routes/peers.ts`, beside the existing launch forward. The client
calls `/api/peers/<name>/<rest>` with its usual `x-mojito-token`; this instance checks the
token (the existing `/api/*` middleware), finds the peer (`deps.peers.config(name)`, else
404 `peer not found`), checks `<rest>` against an **allowlist**, and replays the request at
`<peer.url>/api/<rest>` with the shared token.

Allowlist (method + shape; `:id`/`:project`/`:hash` are single decoded path segments,
re-encoded with `encodeURIComponent` when the peer URL is built, so `..` or `/` in a param can
never reach another peer route):

| Method | Peer path | For |
| --- | --- | --- |
| `DELETE` | `/sessions/:id` (no `remove`) | Kill |
| `POST` | `/sessions/:id/images` | image upload (multipart, body streamed through) |
| `GET` | `/sessions/:id/image?path` | image viewer |
| `GET` | `/projects/:project/git/graph?skip&ticket` | git graph |
| `GET` | `/projects/:project/git/commits/:hash` | commit details |
| `GET` | `/projects/:project/git/commits/:hash/diff?path&from` | diff |
| `GET` | `/projects/:project/docs?ticket` | docs list |
| `GET` | `/projects/:project/docs/file?path&ticket` | a document |

Anything else under `/api/peers/:name/` → 404 `{error}`. (`POST /api/peers/:name/sessions`,
the launch forward, stays as it is.)

Relay rules:

- Request: method, query string verbatim, `content-type` and body passed through (the images
  multipart is streamed, not parsed — the peer validates it). Only `x-mojito-token` is set;
  no other browser header goes on.
- Response: status and body **verbatim**, bytes not re-encoded (the image viewer gets image
  bytes). Headers passed back: `content-type`, `content-length`, `x-content-type-options`,
  `content-security-policy`, `cache-control`. The peer's own `nosniff`/`CSP: sandbox` on
  `/image` thus survive the hop.
- Peer offline (`deps.peers.online(name)` false) → 502 `{error: "<name> is not reachable"}`
  without trying. Fetch fails or the peer's error body is not json → 502 with that same
  message. No answer within the limit → 504 `{error: "<name> did not answer within N s"}`.
  Limit: 30 s (a kill waits on claude leaving; git reads are capped at 10 s on the peer).
- Through `deps.peerFetch`, as the launch forward, so tests inject it.

Pure parts (`peers/relay.ts`): `matchRelay(method, segments, query) → {peerPath} | null` and
the header filter, unit-tested without a server.

### Terminal relay: `/ws/peers/<name>/pty/<id>`

`ws/upgrade.ts` gains a third path. After the token check:

- Unknown peer → destroyed (as an unknown path is today). A known peer with an id not starting with `mj-` (or empty, nested, undecodable) → handshake completed and closed 4404, so the client goes to the board instead of redialling forever (final review).
- Peer offline → handshake completed, closed **1011** (retryable: the client's backoff keeps
  trying and attaches when the peer is back).
- Otherwise this instance dials `<peer.url>/ws/pty/<id>?token=<shared>` (http→ws,
  https→wss) with the `ws` package, **before** completing the browser's handshake, with a
  10 s open timeout. Dial fails → complete and close 1011.
- Once both are open, messages are piped both ways with their type preserved: binary stays
  binary (keys / output), text stays text (the `{"resize":…}` message the client sends on
  every connect).
- Closes are mirrored. The peer's close code goes to the browser as-is when it is
  sendable (1000, 1011, 4404 — `SESSION_GONE_CODE` must arrive intact so the client stops);
  1005/1006 (no code / abnormal) become 1011. A browser close closes the peer side with 1000.
- Heartbeat: the browser side is `markAlive`'d like any pty socket; the peer side is pinged
  every 30 s and terminated after a missed pong (a sleeping Mac sends no close), which then
  closes the browser side 1011.

The peer's pty gateway already marks a gone tmux ended and replays 200 lines of scrollback —
nothing changes on the peer.

### Config, docs

No new configuration: the same `MOJITO_PEERS` and shared `MOJITO_TOKEN`. Update `CLAUDE.md`'s
Peers paragraph ("Nothing else is forwarded …") and the peers spec's "Out of scope" with a
pointer to this document.

## Web

### One way to address a host

`lib/hostApi.ts` (pure): `hostPath(host, path)` → `path` for this instance,
`/api/peers/<host>/<path without /api/>` for a peer; `ptyUrl(host, id, token)` for the
terminal. Every call the session, git and docs pages make goes through it — the existing
`apiFetch`/`apiBlob`/`apiJson` are unchanged. A peer's relay 401 still clears the token
(the shared token was refused), as any 401 does today.

Query keys: `gitKeys` and `docKeys` take the host as part of the key (a project name may
exist on both machines). `qk` is unchanged.

### Terminal page

- Reads `host` from the url. For a peer, the session is found in that peer's snapshot
  (`usePeers`, live through `peers.updated`); the ticket line uses `ticketTitles` (a peer's
  ticket status is not in the snapshot: id + title only — **builder's call** whether to
  widen `ticketTitles` to carry the status name).
- **Ended, gone, offline** — like a local session, which the owner asked for (my call on the
  mechanics). A peer's snapshot holds live sessions only, so "missing from the snapshot"
  cannot mean "never there": a session that ends drops out of it at once, and a session just
  launched by "Run on" may not be in it yet. So the snapshot never sends the reader away;
  **the pty is the authority**, as it already is for a local session that ends:
  - The page remembers the last session it showed for this host+id. When an online peer's
    snapshot loses it, the header keeps that last-known row; the relay brings the peer's
    4404 and the terminal shows its usual "Session ended" state — same as local.
  - A session that was never there: the peer's pty gateway answers 4404 for an id with no
    row, relayed intact; with nothing seen this visit, that 4404 sends the reader to the
    board (the local page's `Navigate` for a missing row, reached through the pty instead of
    the list).
  - A just-launched session not yet in the snapshot attaches normally (the peer has the
    row); the header shows the id from the url until the snapshot catches up.
  - A peer that is **offline** keeps the page: the
  header shows the session as last known with "<peer> · offline", the terminal shows its
  usual reconnecting state, and it re-attaches when the peer is back (its sessions survive a
  peer restart). A page opened cold on an offline peer, with no last-known session, shows
  the terminal's connecting state and the header "<peer> · offline" with the id from the url.
- The header names the host for a peer session (a small "on <peer>" beside the identity) —
  so a session never looks local when it is not. Local sessions are unchanged.
- Kill, images (upload → paths pasted), the image viewer, `.md` paths, Git and Docs buttons
  all go through `hostPath`/carry `host`. After Kill: the board, as local.
- The 4404 rule is unchanged (it arrives intact through the relay).

### Git graph and docs pages for a peer

Reached only from a peer session (terminal header, `.md` paths). Same pages, everything
read through the relay, `host` kept on every internal link. No Pull/Push or other project
action appears on them for a peer (they have none today on these pages; keep it so).

### Sidebar

- Peer rows become in-app `<Link>`s to `/session/<id>?host=<peer>` — the same row behaviour
  as a local one (push from the board, replace from a terminal, plain click closes the
  overlay, Cmd/middle-click still a new tab). The ↗ on rows goes.
- The active-row highlight compares host **and** id.
- The band's ↗ stays and opens `peerHref(peer, "/", token)` in the **same tab** (a plain
  link, no `target`). The peer's client takes the `?token=` handoff as today; Back returns
  here.
- Known limit, not ours to fix: in an installed web app (the Mac's Safari Dock app, scope
  `http://localhost:8700/`) a link to another origin is out of scope, and the platform may
  open it in the browser instead of the app window.

### The board header names the host

Asked by the owner: the board toolbar's `<h1>` shows this instance's name (`self` from
`GET /api/peers`, i.e. `MOJITO_NAME`) instead of "Mojito" — so after a switch through a
band's ↗, in the same tab, it is plain which machine's board this is. "Mojito" shows only
until `/api/peers` has answered. Shown always, with or without peers (my call: the server
always answers `self`). The document title follows: `<self> · Mojito` (my call — it is
what a tab strip and the window switcher show).

### Ticket sheet

- "Session on <peer>" → its Open is an in-app link to `/session/<id>?host=<peer>`.
- "Run on <peer>": after the forward answers 201, **navigate** in-app to the new session
  (as a local launch does). The `window.open("")`-inside-the-click dance and its close on
  failure go: there is no tab anymore. A 409 with `sessionId` navigates to that session on
  that host.

## Testing

- Server: `relay.ts` matcher and header filter (unit); the HTTP relay route with an injected
  `peerFetch` (allowlisted pass-through, status/body/headers verbatim, binary body, 404 off
  the list, 502/504, encoded params); the ws relay against an in-process fake peer `ws`
  server — bytes both ways with types preserved, resize text, 4404 mirrored, peer drop →
  1011, browser close → peer closed. No real tmux.
- Web (`src/lib`, node): `hostPath`/`ptyUrl`, the git/docs codecs keeping and dropping
  `host`, host resolution (self / peer / unknown / not loaded yet), the sidebar's active-row
  match, the terminal page's present / ended / never-there / offline decision as a pure
  function.
- By hand, both machines: open a Mac session from the box's phone client — type, resize,
  paste an image, open an image path and a `.md` path, Git, Kill; sleep the Mac with the
  terminal open, wake it, see it re-attach.

## Left to the builder

- File layout beyond the names above, component splits, exact copy of the "offline" and
  "on <peer>" labels (English, short).
- Whether the ticket line of a peer session shows a status (needs `ticketTitles` widened).
- Relay timeout tuning if 30 s proves wrong for Kill.
