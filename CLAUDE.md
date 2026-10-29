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
  `Settings`, `ProjectRow`), zod request bodies (`LaunchBody`, `ProjectBody`, `SettingsBody`,
  `StatusBody`), `MojitoEvent`, `MODELS`/`EFFORTS`, `SESSION_GONE_CODE` (4404). Consumed as
  source, no build; zod **4** everywhere (the Agent SDK's peer).
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
  Tables: `projects`, `settings` (key/value JSON), `sessions`, `sdk_tasks`. Tickets are never
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
- **The prompt** (`sessions/prompt.ts`) is the whole instruction, in Italian, pinned
  byte-for-byte by its test: read ticket X from Linear and execute it; when ready for
  review, move it to "In Review" on Linear; with brainstorming, one extra line asking for
  `superpowers:brainstorming`. Nothing else — the session decides branches/worktrees itself.
  Mojito writes In Progress; the session writes In Review; Done is the human's.
- **Live state** comes only from Claude Code hooks (`hookSettings.ts` → curl to
  `127.0.0.1:<port>/api/hook` with `x-mojito-token` and claude's hook JSON as body;
  `hookMap.ts`, `hooks.ts`). `ended` is sticky for hooks. Read from the body: SessionEnd
  `reason: "clear"` is ignored (a `/clear` must not end a live session); Notification maps to
  needs-input only for blocking types (`permission_prompt`, `elicitation_dialog`, …) — the
  ~60 s `idle_prompt` after every Stop would otherwise turn every finished session amber.
  `startupStall.ts` flips a session still `starting` after 20 s to needs-input (the
  workspace-trust prompt fires no hook).
- **tmux** (`tmux/tmux.ts`): always **exact targets** — `=name` for sessions, `=name:` for
  panes. tmux matches `-t` by prefix, and `mj-RIC-49` is a prefix of `mj-RIC-49x`: a bare
  target once sent Kill's Ctrl-D to the wrong claude. `closeSession` never forces (Ctrl-C,
  then Ctrl-D re-sent each poll; claude that will not leave → 409). New sessions start in a
  systemd scope of their own (`outsideService`) so they survive `mojito2` restarts.
- **Reconcile at boot** (`reconcile.ts`): rows with no tmux → ended; `mj-*` tmux with no row
  → adopted; ended rows whose tmux is alive → revived to idle.
- **Child environment** (`env/childEnv.ts`): nothing spawned gets raw `process.env` —
  `spawnEnv()`/`sanitizeEnv()` scrub `.env.local` keys (diffed at load), `MOJITO2_*`, bundler
  keys; the Agent SDK additionally drops `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` so it
  always runs on the subscription.
- **WebSockets** (`ws/upgrade.ts`): `?token=` required. `/ws/events` = one JSON
  `MojitoEvent` per message (fire-and-forget bus; clients refetch on every connect).
  `/ws/pty/<id>` attaches only to `mj-` ids with a row; an unknown one gets close **4404**
  (the client must not reconnect); a gone tmux marks the row ended. Protocol at the top of
  `ws/pty.ts`: binary = keys, text `{"resize":{cols,rows}}` sent on **every** (re)connect
  (the pty spawns at 80x24 and only the client corrects it), 200 lines of scrollback replayed
  first. Ping/pong heartbeat reaps half-open phone sockets.
- **HTTP** (`http/`): all `/api/*` except `/health` need `x-mojito-token`; error bodies are
  always `{ error }`; `POST /api/sessions` → 201 `{session, warning?}` or `{error, sessionId?}`.
  Static web build served with SPA fallback (never for `/api` or `/ws`). Listen errors exit 1.
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
- Terminal (`components/terminal`, `lib/terminal`): `syncGeometry` always publishes the size,
  re-fit refused while the iOS keyboard is up; accessory bar (coarse pointers only), composer
  (`term.paste`, no CR — do not turn it into a paste box), buffer copy in a `<pre>`.
  xterm's platform detection was verified correct under Vite, so v1's
  `restoreTerminalPlatform` is not ported; a dev-only warning fires if that ever changes.
- Safe areas: `--sat/--sar/--sab/--sal` in `index.css`; every edge surface pays its inset;
  `test/safeArea.test.ts` guards it.
- Copy is Italian. Only Tailwind utilities + shadcn components; icons are lucide with `size`.

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
