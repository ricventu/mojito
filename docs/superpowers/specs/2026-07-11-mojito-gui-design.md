# Mojito GUI — Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan

## Summary

Mojito GUI is a mobile-first web interface for driving [Lime](../../../../lime) —
the Claude Code plugin that advances a Linear ticket one lifecycle stage per
`/lime-next <TICKET>` invocation. Mojito shows your non-closed Linear tickets,
launches `claude "/lime-next <TICKET>"` stages inside server-side `tmux` sessions,
lets you attach an in-browser terminal (xterm.js) to any session, and alerts you —
in-app — when a session needs your input or a stage finishes.

The user runs Mojito on their own machine and reaches it over the LAN from a phone.
The whole point is to monitor and drive claude sessions from mobile while away
from the desk.

## Runtime context

- **Deployment:** LAN-reachable server on the user's own machine. The server owns
  the local `tmux`/PTY processes and has access to local repos, worktrees, and git.
- **Users:** single user. No multi-tenant model.
- **Client:** mobile-first PWA (installable to the phone home screen).
- **Security posture:** the server exposes a powerful terminal (full filesystem
  access via claude) on the LAN, so it is gated by a static shared-secret token
  (see Security).

## Core insight: tmux is the durable session store

Each lime stage runs as one **detached tmux session** named `mojito-<TICKET>-<status-slug>`,
executing `claude --model <model> --effort <effort> "/lime-next <TICKET>"` in the
ticket's worktree, with `tmux pipe-pane` streaming pane output to a per-session
logfile. This yields most of the feature set directly:

- **Sessions survive server restarts** — tmux owns the process, not Next.js.
- **Monitoring is browser-independent** — driven by Claude Code hooks (see below),
  which fire regardless of whether a phone is attached.
- **Terminal attach is on-demand** — a browser opening xterm spawns a PTY
  (`tmux attach`) only while viewing; disconnect detaches, never kills.
- **Dedup is trivial** — the tmux session name *is* the `(ticket + status)` key;
  `tmux has-session` blocks a duplicate.

## Architecture (chosen: single custom Node server)

One `server.js` wraps Next.js + a `ws` WebSocket server + the tmux control layer +
the monitor. On boot it rediscovers `mojito-*` tmux sessions and resumes monitoring.
Simplest to run (one process), and tmux provides durability so no separate daemon
is needed. This fits single-user LAN; the only trade-off (no serverless deploy) is
irrelevant because the user runs it on their own machine.

Rejected alternatives: a separate session daemon (over-engineered — tmux already
gives durability) and pure Next.js with SSE+POST (awkward terminal input path,
higher latency, and App Router route handlers don't host a background monitor well).

### Stack

Next.js (App Router, React) + custom `server.js` (Next + `ws`) · shadcn/ui +
Tailwind (mobile-first) · xterm.js (+ fit addon) · `node-pty` · `tmux` ·
Linear GraphQL (personal API key).

### Server-side modules (single process)

| Module | Responsibility |
|---|---|
| `tmux` control | create / list / kill / has-session; `pipe-pane` logging; `capture-pane` for scrollback |
| `session registry` | in-memory map of sessions, rebuilt on boot by scanning `mojito-*` sessions + their sidecar files |
| `monitor` | receives Claude Code hook callbacks and turns them into session state + alert events |
| `linear` client | fetch open tickets; fetch a ticket's status; resolve repo via `~/.claude/lime-projects.json` |
| `pty gateway` (WS) | on browser connect, `tmux attach` via node-pty and pipe both ways; detach on close |
| `events` (WS) | push `session.state` + `session.alert` events to the browser |
| REST routes | `GET /api/tickets`, `GET /api/sessions`, `POST /api/sessions` (launch), `DELETE /api/sessions/:id` (dismiss/kill), `POST /api/sessions/:id/advance`, `POST /api/hook` (localhost-only hook sink) |

### Client

Ticket list, sessions list, terminal view (xterm), alert layer (toast + sound +
badge). PWA manifest for home-screen install.

### Persistence

Minimal — no database. Per-session metadata (ticket, launch status, model, effort,
autoAdvance flag, state, createdAt) in a sidecar file per tmux session under a state
directory. tmux + logfiles hold the rest.

## Session lifecycle & tmux model

**Session key & naming.** Key = `<TICKET>` + `<STATUS>`. tmux session name =
`mojito-<TICKET>-<status-slug>` (status lowercased, spaces → hyphens, e.g.
`mojito-RIC-46-to-review`). Real status + metadata live in the sidecar; the name is
just the dedup handle.

**Dedup.** Launch first runs `tmux has-session` on the key. Alive → refuse
("session already open for RIC-46 @ To Review"). Same ticket at a *different* status
is a different key and is allowed. Same ticket+status twice is blocked. This is
exactly the "no multiple sessions for the same ticket+state" rule, enforced by tmux.

**Launch flow.**
1. Resolve cwd: prefer an existing git worktree whose branch matches the ticket ID
   (`git worktree list`); else the repo path from `~/.claude/lime-projects.json`;
   else the base repo. *(lime-integration point — stages ≥ 3 must run inside the
   worktree lime created in stage 1.)*
2. `tmux new-session -d -s <name> -c <cwd>` running
   `claude --model <model> --effort <effort> --settings <generated-file> "/lime-next <TICKET>"`.
3. `tmux pipe-pane -o` → per-session logfile.
4. Write the sidecar (ticket, launch status, model, effort, autoAdvance, createdAt, state).

**Launch options (per session).** A bottom sheet offers a **model** selector
(default `opus`; also `sonnet`, `fable`, or a full ID) and an **effort** selector
(default `high`; also `low`, `medium`, `xhigh`, `max`), passed as `--model` /
`--effort`. Recorded in the sidecar and shown on the session card. Auto-advance
reuses the ticket's prior model/effort.

**Session states:** `starting` → `running` → `needs-input` (a hook fired) →
`running` (output resumes / you reply) → `done` (Linear status advanced OR claude
exited 0) → `failed` (exited non-zero, or exited with status unchanged). State
drives the list badge.

**End behavior.** On `done`, the tmux session stays alive and listed as completed;
scrollback is readable via xterm. The user dismisses it with a tap → `DELETE` kills
the tmux session and removes logfile + sidecar. Launching the next stage creates a
new session under the new `(ticket + status)` key.

**Auto-advance (per-ticket toggle, in sidecar).** On `done`, if the toggle is on:
- new status terminal (`Done`/`Canceled`) → stop.
- new status a human gate (`To QA`, `To Merge`) → do **not** auto-run; surface an
  alert asking for the verdict (`approve`/`reject`) or merge mode (`local`/`mr`),
  tapped by the user and passed as the trailing `/lime-next` arg.
- otherwise → launch the next stage automatically, reusing model/effort.

**Boot recovery.** On start, scan `tmux ls` for `mojito-*`, load sidecars, resume
monitoring. Sessions started before a restart keep running and reappear in the list.

## Monitoring & detection (hook-based, no idle timing)

Idle-timing detection was explicitly rejected: background agents make long silences
normal, so idle would false-fire constantly. Detection uses **Claude Code's own
hooks** instead — deterministic signals from claude, no TUI scraping, no timers.

**Injection.** Each session is launched with `--settings <generated-file>` that
injects (a) an `env` block `{ MOJITO_SESSION, MOJITO_PORT }` and (b) hook commands
that fire-and-forget POST to `http://127.0.0.1:$MOJITO_PORT/api/hook`, carrying the
session key plus the hook's stdin JSON. The file lives in Mojito's state dir; hooks
merge with the repo's own settings, so nothing committed is clobbered.

**Hooks → events.**

| Hook | Meaning | Mojito reaction |
|---|---|---|
| `PermissionRequest` | claude needs tool approval | → `needs-input`, alert "needs permission" |
| `Notification` | claude signals attention needed | → `needs-input` (supplementary) |
| `Stop` | turn ended — claude idle at prompt | disambiguate via an immediate Linear fetch: status advanced → `done`; unchanged → `needs-input` (claude asked you something) |
| `SessionEnd` | claude process exited | `done` if status advanced, else `failed` |

The `Stop` + Linear cross-check replaces idle detection: turn-end is a hard signal
from claude, and the Linear status tells us *why* it stopped (finished the stage vs.
waiting on you). Immune to long background-agent silences.

**Logfile** (`pipe-pane`) is kept only for xterm scrollback replay and debugging —
not used for detection.

**Events to browser** (events WS): `session.state`; `session.alert {kind, ticket,
message}` → toast + sound + tab badge.

**Implementation caveat (smoke-tested first):** whether `Stop` truly leaves claude
interactive after a positional-prompt launch (vs. exiting) is verified before
building on it. If a stage-end exits instead, `SessionEnd` + status covers the same
case identically.

## Terminal transport

**Client:** xterm.js + fit addon. Tapping a session card opens the terminal view;
on mount it opens a WebSocket (`/ws/pty?session=<key>`) and pipes xterm ⇄ socket.

**Server:** for that socket, spawn `node-pty` running `tmux attach-session -t <name>`;
bytes flow both ways. On WS close (navigate away / phone sleeps) → kill the node-pty
only (detaches that tmux client); the tmux session and claude keep running. Never
kill the session on disconnect.

**Reconnect (mobile-critical):** the WS client auto-reconnects with backoff. On
reattach, prime xterm with `tmux capture-pane -p -S -<N>` (last N lines) before
wiring the live stream, then let tmux redraw. Backgrounding the phone and returning
shows a coherent screen, not a blank one.

**Resize:** xterm fit → send `{cols,rows}` over the WS → `pty.resize()` → tmux
resizes the pane to the phone. When no client is attached the pane holds its last
size; background claude runs regardless.

**Mobile keyboard:** xterm's hidden textarea drives the soft keyboard (tap to focus).
Above it, a compact **accessory bar** with keys a phone can't easily send: `Esc`,
`Tab`, `Ctrl`, arrow keys, `Enter`, `Ctrl-C`, and quick `1`/`2`/`3` chips for
claude's numbered permission prompts. At a gate (To QA / To Merge) the accessory bar
swaps for action buttons: `Approve`/`Reject` or `Local`/`MR`.

**`done` sessions stay writable** — claude is still alive at the prompt.

## Linear integration

**Auth:** `LINEAR_API_KEY` (personal key) in server env only — never sent to the
client. All Linear calls are server-side.

**Ticket list** (`GET /api/tickets`): GraphQL for issues assigned to the key's user
with `state.type ∉ {completed, canceled}` (triage/backlog/unstarted/started), sorted
by project then number; returns id, title, status name+type, project, labels. Client
refreshes on a ~45s poll + pull-to-refresh + after any launch/stage-done.

**Per-session status polling:** the `Stop`-hook disambiguation triggers an immediate
Linear fetch for that ticket (freshest signal). A slow ~30s background poll per active
session is a backstop for missed hooks.

**Repo / worktree resolution** (shared with lime): read `~/.claude/lime-projects.json`
(team key → repo path, per-project overrides), prefer an existing worktree matching
the ticket ID, else the mapped repo, else base repo. `LIME_PROJECTS` overrides the
map path (matches lime).

**Rate limits:** conservative intervals + short in-memory cache; hook-driven fetches
are one-shot.

## UI / screens (mobile-first)

Bottom tab bar for thumb reach: **Tickets** | **Sessions** (Sessions tab shows a
badge count when any session needs input).

- **Tickets (home):** non-closed tickets grouped by project; each card shows ID,
  title, status badge, labels. Tap → launch sheet (model/effort/auto-advance + Start).
  If a session for that ticket+status already exists, the sheet shows **Open** instead
  of Start (dedup surfaced in UI).
- **Sessions:** active + done sessions; each card shows ticket · status, state badge
  (● running · ⚠ needs-input · ✓ done · ✕ failed), model · effort, auto-advance
  indicator, and a message line. needs-input cards are highlighted. Swipe/tap to
  dismiss.
- **Terminal (full-screen):** header (ticket · status · state), xterm viewport,
  accessory key bar; gate action buttons when applicable.
- **Alerts:** toast + sound + tab badge while the PWA is open; tapping the toast
  deep-links to that session's terminal.

## Errors, edge cases, security

**Security:**
- Static shared-secret token in server config, entered once in the PWA (localStorage),
  required on every REST + WS request. Server binds `0.0.0.0` but is gated by the token.
- `LINEAR_API_KEY` server-side only.
- `/api/hook` bound to `127.0.0.1` only — only local claude processes can post; each
  carries its `MOJITO_SESSION`.

**Edge cases:**
- Dup launch (tmux session exists) → 409; UI shows **Open**.
- No repo resolvable → toast "no mapping for TEAM — add to lime-projects.json".
- `tmux`/`claude` missing → startup preflight check with a clear message.
- Linear down / rate-limited → keep last good ticket list with a stale indicator;
  hooks still work.
- Server restart mid-session → boot recovery reattaches.
- Missed hook (curl fails) → backstop status poll still catches `done`; worst case a
  needs-input isn't pushed, but the session is still visible.
- Unexpected process death → `SessionEnd`/no-process → `failed`.
- External Linear status change → poll picks it up.
- Dismiss a running session → confirm dialog (kills claude).
- Mobile audio autoplay policy → unlock alert sound on first user gesture.

## Testing

- **Unit:** session-key/status-slug sanitization; dedup decision; repo/worktree
  resolution; hook-payload → event mapping; `Stop` + status disambiguation;
  auto-advance decision (gate/terminal/normal).
- **Integration:** tmux control module against real tmux (create/has/kill/pipe-pane/
  capture, unique test prefix, cleaned up); node-pty attach round-trip; Linear client
  against a mock GraphQL.
- **Manual smoke (LAN):** real `claude "/lime-next"` stage → hook callbacks arrive →
  attach terminal from the phone → needs-input alert on a permission prompt → done on
  status advance → reconnect after backgrounding. Includes the `Stop`-vs-`SessionEnd`
  smoke test as the first thing verified.
- **Stack:** Node test runner or vitest; mocked Linear; tmux harness.

## Out of scope (YAGNI)

- Web Push / external notification channels (ntfy/Telegram) — in-app alerts only.
- Multi-user / auth beyond the shared-secret token.
- A separate session daemon.
- Persisting session history in a database.
