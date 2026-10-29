# Mojito v2

Mojito manages Linear tickets per project and runs them as Claude Code sessions in tmux,
shown in the browser through xterm. **This is the `v2` branch**: the rewrite lives in a
pnpm workspace under `apps/` and `packages/`. The old Next.js app (`src/`, `server.ts`,
`tests/`, `next.config.mjs`) is still in the tree but is **v1, developed on `main`** in the
`~/code/mojito` checkout — do not change it from here. Work for v2 happens in `apps/` and
`packages/` only. Design: `docs/superpowers/specs/2026-10-28-mojito-rewrite-core-design.md`.

**v2 is a rethink, not a port.** v1 is a reference for *what* a feature does and which
problems it already ran into (its `CLAUDE.md`, `git show main:CLAUDE.md`, records many) —
never for *how*. Every feature is redesigned for v2's stack and made better: simpler, fewer
controls, a better interaction where one exists, phone-first. Do not copy v1's structure,
components or file layout; when a ticket references v1 code, read it to learn the
requirements and the pitfalls, then design the v2 solution and propose it before coding.

v1 and v2 run side by side on the Linux box and never share state:

| | v1 | v2 |
|---|---|---|
| branch / checkout | `main`, `~/code/mojito` | `v2`, `~/code/mojito-v2` |
| service | `mojito.service` (8700) | `mojito2.service` (3100) |
| state | `~/.local/state/mojito` | `~/.local/state/mojito2` (SQLite `mojito.db`) |
| tmux ids | `mojito-…` | `mj-…` |
| phone URL | `https://ai-tonic.<tailnet>.ts.net/` | `…ts.net:8443/` (Tailscale Serve → 3100) |

`.env.local` in `~/code/mojito-v2` is a symlink to v1's: the token (`MOJITO_TOKEN`) and the
Linear key (`LINEAR_API_KEY`) are shared, everything else is v2's own (`MOJITO2_PORT`,
`MOJITO2_HOST` — v2 deliberately ignores v1's `MOJITO_PORT`/`MOJITO_HOST`).

## Layout

- `packages/shared` — types (`SessionMeta`, `TaskRecord`, `TicketSummary`, `BoardTickets`,
  `Settings`, `ProjectRow`, `Favorite`), zod request bodies (`LaunchBody`, `ProjectBody`, `SettingsBody`,
  `PromptsBody`, `FavoritesBody`, `StatusBody`, `SessionPatchBody`), `MojitoEvent`, `MODELS`/`EFFORTS`, `DEFAULT_PROMPTS`,
  `SESSION_GONE_CODE` (4404). Consumed as source, no build; zod **4** everywhere (the Agent
  SDK's peer).
- `apps/server` — Node 22, Hono 4 on `@hono/node-server`, `ws` on the http `upgrade` event,
  `node-pty`, `better-sqlite3`. Built with tsup (`tsup.config.ts` bundles `@mojito/shared`
  — without `noExternal` the built server dies importing `.ts`).
- `apps/web` — React 19, Vite, Tailwind 4, shadcn/ui (Radix) under `src/components/ui`,
  react-router, TanStack Query, `@xterm/xterm` 6 (DOM renderer, no WebGL), lucide icons.
  `vite.config.ts` sets `css.postcss: {}` so Vite does not pick up v1's Tailwind 3 PostCSS
  config at the repo root; the root `tsconfig.json` excludes `apps`/`packages` so v1's
  `next build` never compiles v2.

## Server

- **Persistence** (`src/db`): migrations are TS modules exporting SQL (`migrations/*.ts`,
  applied once each, in a transaction) — `.sql` imports break under vitest and `tsx watch`.
  Tables: `projects`, `settings` (key/value JSON), `sessions` (`hidden` since migration 003),
  `sdk_tasks`. Tickets are never
  stored: `tickets/cache.ts` polls Linear every 45 s, scoped to the mapped project names,
  coalesces concurrent refreshes, keeps the last list (`stale`) when Linear fails.
  `projects.json` (`~/.config/mojito/projects.json`) is imported once per database, then
  projects are edited in Settings.
- **Launch** (`sessions/launch.ts`): validate (ticket in cache, project mapped, path absolute
  and existing — a project path may be `~`/`~/…`, stored as typed and expanded to HOME by
  `homePath.ts` wherever it meets the disk) → in-memory lock per id (double tap = one 201 +
  one 409) → live row check (dead tmux → row ended, proceed; live → 409 with `sessionId`) →
  write hook settings (`<stateDir>/hooks/<id>.json`, mode 0600) → `newSession` → insert row
  `starting` → stall watch → Linear writes (In Progress + assign; failures become a
  `warning`, never fail the launch). Ticket id `mj-<TICKET>`, free sessions `mj-<slug>-<hex6>`.
- **The prompt** is the whole instruction, in English: read ticket X from Linear and execute
  it; when ready for review, move it to "In Review" on Linear; use `superpowers:brainstorming`
  first only if the ticket leaves design decisions open. Brainstorming is not a launch option —
  the session decides it, like branches/worktrees. Nothing else.
  Mojito writes In Progress; the session writes In Review; Done is the human's.
- **Prompts are settings** (RIC-513): the ticket prompt (a template; `{ticket}` required,
  filled by `buildTicketPrompt`) and the create-ticket system prompt. Defaults live in
  `shared/src/prompts.ts` (`DEFAULT_PROMPTS`; the ticket one pinned byte-for-byte by
  `prompt.test.ts`), one line per paragraph so they edit cleanly in a phone textarea. The
  `prompts` settings key stores only the edits — a prompt equal to its default is dropped, so it
  follows later changes to the shipped text. Read via `deps.prompts()` at each launch/task, no
  restart. `PUT /api/settings` is partial: each top-level key sent replaces that part only,
  and every success emits `settings.updated` (the web invalidates `qk.settings`, so a change on
  one device shows on another).
- **Favourites** (RIC-502) are the `favorites` settings key: `{name, search}[]`, validated by
  shape only (≤ 50, name trimmed 1-60 and unique case-insensitively, `search` ≤ 2000) — the
  server never interprets `search`, the client's `parseFilters` does.
- **Hidden sessions**: `sessions.hidden` is sidebar-only state (the board, the waiting pill and
  Kill ignore it), set by `PATCH /api/sessions/:id` (`SessionPatchBody`, strict: unknown id 404,
  any other body 400; emits `session.updated`). A launch writes a fresh row, so a relaunched
  session is visible again; adoption writes `false`, a revive keeps the row's value.
- **Live state** comes only from Claude Code hooks (`hookSettings.ts` → curl to
  `<selfOrigin>/api/hook` — the configured host, loopback only for a wildcard bind — with
  `x-mojito-token` and claude's hook JSON as body; `hookMap.ts`, `hooks.ts`). `ended` is
  sticky for hooks. Read from the body: SessionEnd `reason: "clear"` is ignored (a `/clear`
  must not end a live session) and the SessionStart `source: "clear"` after it maps to idle;
  Notification maps to
  needs-input only for blocking types (`permission_prompt`, `elicitation_dialog`, …) — the
  ~60 s `idle_prompt` after every Stop would otherwise turn every finished session amber.
  `startupStall.ts` flips a session still `starting` after 20 s to needs-input (the
  workspace-trust prompt fires no hook).
- **tmux** (`tmux/tmux.ts`): always **exact targets** — `=name` for sessions, `=name:` for
  panes. tmux matches `-t` by prefix, and `mj-RIC-49` is a prefix of `mj-RIC-49x`: a bare
  target once sent Kill's Ctrl-D to the wrong claude. `hasSession` answers false only when
  tmux says the session/server is not there; any other failure rejects (unreachable is not
  dead — the pty gateway then closes 1011, retryable). `closeSession` never forces (Ctrl-C,
  then Ctrl-D re-sent each poll; claude that will not leave → 409). New sessions start in a
  systemd scope of their own (`outsideService`) so they survive `mojito2` restarts.
- **Reconcile at boot** (`reconcile.ts`): rows with no tmux → ended; `mj-*` tmux with no row
  → adopted; ended rows whose tmux is alive → revived to idle.
- **Child environment** (`env/childEnv.ts`): nothing spawned gets raw `process.env` —
  `spawnEnv()`/`sanitizeEnv()` scrub `.env.local` keys (diffed at load), `MOJITO2_*`, bundler
  keys; the Agent SDK additionally drops `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` so it
  always runs on the subscription.
- **WebSockets** (`ws/upgrade.ts`): `?token=` required. `/ws/events` = one JSON
  `MojitoEvent` per message (fire-and-forget bus; clients refetch on every connect and
  redial with a 1 s → 15 s backoff).
  `/ws/pty/<id>` attaches only to `mj-` ids with a row; an unknown one gets close **4404**
  (the client must not reconnect); a gone tmux marks the row ended. Protocol at the top of
  `ws/pty.ts`: binary = keys, text `{"resize":{cols,rows}}` sent on **every** (re)connect
  (the pty spawns at 80x24 and only the client corrects it), 200 lines of scrollback replayed
  first. Ping/pong heartbeat reaps half-open phone sockets.
- **HTTP** (`http/`): all `/api/*` except `/health` need `x-mojito-token`; error bodies are
  always `{ error }`; `POST /api/sessions` → 201 `{session, warning?}` or `{error, sessionId?}`.
  Static web build served with SPA fallback (never for `/api` or `/ws`). Listen errors exit 1.
- **Images for a session** (`POST /api/sessions/:id/images`, `sessions/images.ts`): claude's
  own image paste reads the server's clipboard, never the browser's, so the client uploads
  and pastes the returned absolute paths, which claude turns into `[Image #N]`. Stored in
  `<stateDir>/images/<id>/` (0700/0600), never the repo — claude attaches a pasted image path
  outside its cwd without a permission prompt and downscales big ones itself (both verified
  on 2.1.312), hence the shared 10 MB cap. Deleted with the row (`?remove=1`).
- **Create-ticket task** (`tasks/`): Agent SDK `query()` with `settingSources: []`,
  `tools: []`, an in-process MCP (`mojito-linear`: `list_labels`, `create_issue`) bound to the
  task's team/project, at most one issue per task; a task that created its issue is `done`
  even if the stream throws afterwards (retry must not duplicate). Images are validated
  (png/jpeg/gif/webp, ≤10, ≤10 MB) and uploaded to Linear **before** the task row exists.

## Web

- Pure logic lives in `src/lib` and is unit-tested in node (no jsdom); components are glue.
- `lib/eventStream.ts` + `hooks/useEvents.ts`: refetch everything on each ws connect and on
  `visibilitychange`; events patch the query cache.
- Board (`lib/board.ts` → `components/board`): one section per project, In Review → In
  Progress → Todo, Backlog collapsed; free sessions and sessions whose ticket is no longer on
  the board stay visible as loose rows (a live tmux never disappears from the UI).
- **Board filters** (RIC-502): project (multi), status, text — the url is the only state
  (`lib/filters.ts` codec, `hooks/useBoardFilters.ts`). Writes **replace** the history entry
  (Back leaves the board, not one chip). `q` keeps its spaces in the live url (trimming would
  eat the space typed between two words); `canonicalSearch` trims it, and favourites are saved
  in and compared by that form. The search field keeps a local draft: react-router 8 applies
  navigations asynchronously in a transition, so a url-controlled input loses caret and
  keystrokes. `filterBoard` runs after `groupBoard`: a project filter drops General, a status
  filter drops loose sessions and statuses outside `FILTER_STATUSES`; Backlog opens
  (`backlogOpen`) when selected or `q` is set, so a search never hides a match in a closed
  group. `lib/boardReturn.ts` keeps the last board search in `sessionStorage` (per tab) for the
  terminal's Board link and Kill's navigation, best effort.
- **Favourites** (`lib/favorites.ts`, `hooks/useFavorites.ts`): chips under the search row
  (tap the active one = clear), saved from the filter sheet (a same-name save replaces in
  place), managed in the Settings `FavoritesCard`. The PUT replaces the whole list, so nothing
  writes before settings have loaded (`ready`). `save(update)` computes from the newest queued
  write (else the cache) at call time, and the PUTs run serially in one mutation scope; the
  queued variables are the optimistic state, so a refetch mid-queue can neither flash an older
  list nor be the next write's base. `settings.updated` does not invalidate while writes are
  queued; the queue re-reads once it drains. Error → toast, no remembered rollback.
- **Session sidebar** (`components/sidebar`, `lib/sidebar.ts`, `hooks/useSidebar.ts`): every
  non-`ended` session, unfiltered by the board, grouped by project (General last), newest
  `createdAt` first — only immutable keys, so rows never jump when a state changes. Hide is
  per row (optimistic `setQueryData`, a failed `PATCH` re-reads), with a "Hidden (n)" footer.
  Unpinned it is a left `Sheet` overlay (never resizes the pty); pinned it is a docked `w-72`
  column, only at ≥ 1024px (`useMediaQuery`), pin in `localStorage` (`mojito2-sidebar-pinned`,
  read in the `useReducer` initialiser so it docks on the first render, no pty resize twice).
  The open/pin state machine is `lib/sidebarState.ts`: closing a docked sidebar — unpin, ✕ or
  the toggle — also **drops the pin** (as v1 did: a kept pin would re-dock it on the next
  open); below 1024px a docked sidebar closes and keeps its pin, re-docking above it. Rows are
  `<Link>`s (Cmd/middle-click, iOS long-press; a plain click closes the overlay). Picking a row
  pushes from the board, **replaces** from a terminal (Back stays "the board"). A docked
  sidebar is not rendered while the iOS keyboard is up.
- Overlay sheets (filter, sidebar) draw their own ✕ (`showCloseButton={false}`): shadcn's
  built-in one is absolutely positioned and ignores the safe-area insets.
- Terminal (`components/terminal`, `lib/terminal`): `syncGeometry` always publishes the size,
  re-fit refused while the iOS keyboard is up; accessory bar (coarse pointers only), composer
  (`term.paste`, no CR — do not turn it into a paste box), buffer copy in a `<pre>`.
  Images (`lib/terminal/imageInput.ts`): a paste with images and no text (capture phase on
  the holder, ahead of xterm), a drop, or the accessory bar's picker (exact types, so iOS
  hands HEIC over as JPEG) — uploaded, then the paths pasted into claude.
  Desktop mouse copy (`copySelection.ts`): a plain drag is **claude's own** selection, which
  it copies with an OSC 52 — reaching the browser only because the pty gateway sets
  `allow-passthrough on` at every attach, and handled by a write-only OSC 52 handler. A
  Shift/Option+drag is xterm's, **copied on release**: claude's any-motion mouse tracking
  makes xterm clear it on the next mouse move, so Cmd+C/right-click never find it.
  xterm's platform detection was verified correct under Vite, so v1's
  `restoreTerminalPlatform` is not ported; `platform.build.test.ts` bundles xterm with the
  app's Vite config and fails if anything starts shimming `process` (a dev warning too).
- Safe areas: `--sat/--sar/--sab/--sal` in `index.css`; every edge surface pays its inset;
  `test/safeArea.test.ts` guards it.
- Copy is English, like everything else in v2 (code, comments, server messages, agent
  prompts); the only Italian left is the create-ticket agent's output (tickets on Linear).
  Only Tailwind utilities + shadcn components; icons are lucide with `size`.

## Commands

```bash
pnpm v2:dev                    # server (tsx watch, :3100) + Vite (:5173, proxies /api and /ws)
pnpm v2:test && pnpm v2:typecheck
pnpm v2:build                  # apps/web/dist + apps/server/dist/main.js
make v2-deploy                 # from ~/code/mojito-v2: pull (if tracked), frozen install,
                               # build, restart mojito2, wait for /api/health
journalctl --user -u mojito2   # logs
```

The tmux integration test drives a real tmux with `mj-test-*` sessions and can be flaky
under load — re-run it alone before believing a failure. Never let a test touch other tmux
sessions: the box runs live v1 and v2 agents.
