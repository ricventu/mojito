# Mojito

Mojito manages Linear tickets per project and runs them as Claude Code sessions in tmux,
shown in the browser through xterm. A pnpm workspace under `apps/` and `packages/`. Core
design: `docs/superpowers/specs/2026-10-28-mojito-rewrite-core-design.md`.

**This is v2, a rewrite that replaced the Next.js app** (cut-over: RIC-511,
`docs/superpowers/specs/2026-10-30-cut-over-design.md`). The old app is kept at the `v1`
tag: a reference for *what* a feature did and which problems it ran into (its `CLAUDE.md`,
`git show v1:CLAUDE.md`, records many) — never for *how*. A feature that still exists only
there is redesigned for this stack and made better: simpler, fewer controls, a better
interaction where one exists, phone-first. Read v1 for the requirements and the pitfalls,
then design and propose before coding. Dropped on purpose: the `mojito` CLI (RIC-507),
the in-app "Pull & deploy" and the service worker (RIC-508) — `make deploy` updates Mojito.

On the Linux box: `main` checked out in `~/code/mojito`, `mojito.service` on 8700
(127.0.0.1), state in `~/.local/state/mojito` (SQLite `mojito.db`), tmux ids `mj-…`, the
phone at `https://ai-tonic.<tailnet>.ts.net/` (Tailscale Serve → 8700). The server reads
`.env.local` at the repo root: `MOJITO_TOKEN`, `LINEAR_API_KEY`, `MOJITO_PORT`,
`MOJITO_HOST`. `~/.mojito-state` is the old app's state, left in place.

## Layout

- `packages/shared` — types (`SessionMeta`, `TaskRecord`, `TicketSummary`, `BoardTickets`,
  `Settings`, `ProjectRow`, `Favorite`), zod request bodies (`LaunchBody`, `ProjectBody`, `SettingsBody`,
  `PromptsBody`, `FavoritesBody`, `StatusBody`, `SessionPatchBody`), `MojitoEvent`, `MODELS`/`EFFORTS`, `DEFAULT_PROMPTS`,
  `SESSION_GONE_CODE` (4404), the git graph types (`GitGraphPage`, `GraphCommit`, `GraphRef`,
  `GraphHighlight`, `CommitDetails`, `CommitFile`, `CommitDiff`) and `isValidHash`/`isValidTicket`, the docs
  types (`DocEntry`, `DocList`, `DocFile`, `DOC_MAX_BYTES`) and `isDocPath`. Consumed as source, no build; zod **4** everywhere (the Agent
  SDK's peer).
- `apps/server` — Node 22, Hono 4 on `@hono/node-server`, `ws` on the http `upgrade` event,
  `node-pty`, `better-sqlite3`. Built with tsup (`tsup.config.ts` bundles `@mojito/shared`
  — without `noExternal` the built server dies importing `.ts`).
- `apps/web` — React 19, Vite, Tailwind 4, shadcn/ui (Radix) under `src/components/ui`,
  react-router, TanStack Query, `@xterm/xterm` 6 (DOM renderer, no WebGL), lucide icons.

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
  the session decides it, like branches. Nothing else, except the ticket sheet's "Work in a
  worktree" switch (off by default, `LaunchTicketBody.worktree`): on, `buildTicketPrompt` appends
  the fixed `WORKTREE_INSTRUCTION` (not a setting) as the last line.
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
  systemd scope of their own (`outsideService`) so they survive `mojito` restarts.
- **Reconcile at boot** (`reconcile.ts`): rows with no tmux → ended; `mj-*` tmux with no row
  → adopted; ended rows whose tmux is alive → revived to idle.
- **Child environment** (`env/childEnv.ts`): nothing spawned gets raw `process.env` —
  `spawnEnv()`/`sanitizeEnv()` scrub `.env.local` keys (diffed at load), `MOJITO_*`, bundler
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
  The other way, `GET /api/sessions/:id/image?path` (`sessions/viewImage.ts`) serves an image path
  claude printed, for the terminal's viewer: relative to the session's cwd, `~/` from HOME, an
  absolute one **anywhere** — the token already opens a shell in every session, and a fence would
  miss claude's scratchpad (`/tmp/claude-<uid>/…`). What keeps it a viewer: `isImagePath`, a
  regular file ≤ 10 MB, the type sniffed from the bytes (a `.png` holding `.env` is 415), served
  `nosniff`, `CSP: sandbox`, `no-store`.
- **Pull / Push** (`git/`, `POST /api/projects/:name/pull|push` → `GitSyncResult`): git with no
  shell, `LC_ALL=C` (sync.ts reads its messages) and `GIT_TERMINAL_PROMPT=0`. Pull = fetch, then
  fast-forward if only behind, rebase onto `@{u}` if diverged **on a clean tree**; push = push to
  the upstream (`-u origin HEAD` with none), never forced, and a rejection for being behind runs
  the pull and retries once. Mojito never stashes and never leaves a half-done repo — ticket
  sessions share the checkout: a rebase conflict is aborted, and that or uncommitted changes in
  the way is a `conflict`, handed to the project's git session (`launchGitResolve`, opus/xhigh,
  fixed id `mj-<slug>-git`: a live one is answered `alreadyOpen`, never doubled). Failures with
  nothing to resolve (no upstream, detached, network) are 422 `{error}`; one op per project at a
  time (409). `test/git/sync.test.ts` runs real git in a temp dir with the global config off.
- **Git graph** (RIC-505, `git/graph.ts`, `ticketBranch.ts`, `defaultBranch.ts`, `commit.ts`,
  `http/routes/gitGraph.ts`): read-only — `GET /api/projects/:name/git/graph?skip&ticket`,
  `…/git/commits/:hash` and `…/commits/:hash/diff?path&from`. Never a `fetch` or any write: the
  graph shows what the last Pull saw. Reads run through `readGit` (10 s), Pull/Push keep `runGit`
  (120 s). Hash shape (`isValidHash`) and ticket shape (`isValidTicket`, both in `@mojito/shared`)
  are checked before any git call, the hash is resolved with `rev-parse --verify` and only the full
  one goes on. A page is 200 commits (git asked for 201 — the extra only says `hasMore`), files cap
  300, diff cap 256 KB cut at a line end. A `GitError` is a 409 with git's words (500 chars; a
  timeout reads `git did not answer within N s`, a NUL in `path`/`from` is a 400 before git);
  `GitError.exitCode` is null on a timeout, so a commit is "not found" (404) only on exit 1 — a
  timeout or "not a repo" must not read as a missing commit. `findTicketBranch` (the ticket id as a
  whole token of a branch name; local beats `origin/`, then worktree, then newest) is pure and
  reusable — a merge gate can ask it the same question. Diff pathspecs are `:(top,literal)<path>`:
  name-status paths are repo-root-relative and a project may be a subdirectory of its repo, and a
  name must not be a glob.
- **Docs** (RIC-506, `docs/`, `http/routes/docs.ts`): read-only — `GET /api/projects/:name/docs?ticket`
  → `DocList`, `…/docs/file?path&ticket` → `DocFile`. The root is the project checkout, unless the
  ticket's branch (`findTicketBranch`) is checked out in another live worktree: then that worktree
  plus the checkout's `--show-prefix` (`docRoot`; any failure → the checkout). The list is `git
  ls-files -z --cached --others --exclude-standard` of `:(icase)*.md` in the root (`.gitignore`
  respected, nested worktrees never descended into, `-z` so odd names arrive as themselves), each
  `stat`ed, newest first; only that call may fail the list (409 with git's words). A ticket's own
  are the id as a whole token of the path (`ticketToken`, shared with `findTicketBranch`) ∪ `git grep
  --no-full-name -F -w -i --untracked` on bodies ∪ the md its branch touched against its base — best-effort;
  `CLAUDE.md` lands in every ticket's group (it cites them all). v2 sessions work in the checkout,
  so the id is what finds a ticket's spec, not a branch. The path guard (`resolveDocPath`) answers
  400, never 404: `isDocPath`, a relative path stays inside the root, an absolute (or `~/`) one only
  inside one of the repo's live worktrees, re-checked after `realpath` (still inside, still `.md`:
  a `notes.md` symlinked to `.env` is refused). Read from disk, so an
  uncommitted spec is readable; over 512 KB → 413.
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
- Project header: Pull / Push icons (`GitButtons`, `lib/gitSync.ts`) — a toast, or on a conflict
  the git session's terminal (pushed, from the board).
- **Git graph page** (RIC-505, `/git/:project`, `components/git`, `lib/git`, `hooks/useGitGraph.ts`):
  `ticket`/`commit`/`file`/`from` are the only view state (`lib/git/url.ts` is the one codec —
  `gitHref` for entry points, `parseGitSearch` drops what makes no sense). Entry points: project
  header, ticket sheet (ticket highlighted), terminal header (`icon-sm`, absent for General).
  `gitKeys` lives **outside `qk`** on purpose: `useEvents` invalidates every `qk` value on each
  reconnect, and the graph is a snapshot — rows jumping under the reader is worse than one fetch
  behind. `gcTime: 0`: each entry to the page is a fresh read, never a refetch under the reader.
  No focus/reconnect refetch; Reload and a Pull/Push (every outcome, a conflict too —
  `GitButtons` invalidates `gitKeys.graphs(project)`) refresh it. `pageCommits` drops commits a
  later `--skip` page repeats when the repo moved between pages. "Is there an in-app entry
  behind" is react-router's `window.history.state.idx` (`useBackOr`, `lib/git/sheetNav.ts`), never
  `location.key`: a `replace` keeps idx but changes the key. Closing the commit sheet from a diff
  returns to the graph (two steps back when the details entry sits over it, else a replace).
  First load scrolls to the tip only with a ticket (the project view opens at the top). The
  checkout strip (no ticket) never says "merged" — a branch 0 ahead of its upstream is only
  behind; no base → no chain, nothing dimmed.
- **Docs page** (RIC-506, `/docs/:project?ticket&path`, `components/docs`, `lib/docs`,
  `hooks/useDocs.ts`): `lib/docs/url.ts` is the codec (`docsHref` drops a leading `./`); opening a
  document pushes, so Back steps document → list → origin. Entry points: project header, ticket
  sheet (beside Git), terminal header (absent for General), and `.md` paths in the terminal.
  With a ticket the list shows its group first, then "All documents". `docKeys` lives outside `qk`
  (as `gitKeys`), `gcTime: 0`, no focus refetch: each entry reads afresh, Reload resets; the list
  is not read under an open document. `MarkdownView`: `react-markdown` + `remark-gfm`, no raw HTML,
  `prose` from `@tailwindcss/typography`; links by `classifyHref` — http(s) a new tab, mailto plain,
  a relative `.md` the viewer (resolved against the document's directory, climbing above a relative
  root is inert), anything else inert text; images show their alt text only (no fetch).
- **Board filters** (RIC-502): project (multi), status, text — the url is the only state
  (`lib/filters.ts` codec, `hooks/useBoardFilters.ts`). Writes **replace** the history entry
  (Back leaves the board, not one chip). `q` keeps its spaces in the live url (trimming would
  eat the space typed between two words); `canonicalSearch` trims it, and favourites are saved
  in and compared by that form. Its projects sort with plain `sort()`, never the device's
  locale (favourites compare as strings across devices); display order (sections, sidebar,
  sheet) is `byProjectName`, `localeCompare(b, "en")`. The search field keeps a local draft: react-router 8 applies
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
- **Session sidebar** (`components/sidebar`, `lib/sidebar.ts`, `hooks/useSidebar.ts`): drawn
  once for every page by the layout route `AppShell` (a pinned one stays put from page to page;
  pages reach it through `useAppSidebar`/`SidebarToggle`, and each starts after it with
  `[var(--dock-width)]`, guarded by `safeArea.test.ts`). Every
  non-`ended` session, unfiltered by the board, grouped by project (General last), newest
  `createdAt` first — only immutable keys, so rows never jump when a state changes. Hide is
  per row (optimistic `setQueryData`, a failed `PATCH` re-reads), with a "Hidden (n)" footer.
  Unpinned it is a left `Sheet` overlay (never resizes the pty); pinned it is a docked `w-72`
  column, only at ≥ 1024px (`useMediaQuery`), pin in `localStorage` (`mojito-sidebar-pinned`,
  read in the `useReducer` initialiser so it docks on the first render, no pty resize twice).
  The open/pin state machine is `lib/sidebarState.ts`: closing a docked sidebar — unpin, ✕ or
  the toggle — also **drops the pin** (as v1 did: a kept pin would re-dock it on the next
  open); below 1024px a docked sidebar closes and keeps its pin, re-docking above it. Rows are
  `<Link>`s (Cmd/middle-click, iOS long-press; a plain click closes the overlay). Picking a row
  pushes from the board, **replaces** from a terminal (Back stays "the board"; the shell reads
  `/session/:id`). A docked sidebar is not rendered while the iOS keyboard is up (the terminal
  tells the shell, `useKeyboardUp`, in a layout effect).
- **Desktop first, phone complete.** The board column is `max-w-6xl`, an `@container`: from
  `@2xl` (by its own width, which a docked sidebar narrows) each project's active tickets are
  kanban columns Todo → In Progress → In Review (`kanbanColumns`: all three even when empty, so
  they line up across projects; "Other" only for a custom status; a status filter keeps only its
  columns), with Backlog collapsed and the loose sessions in three columns below; under it, the
  phone's list. Both are rendered and CSS picks one (nothing to measure, no jump). The board's modals (ticket,
  new ticket, new session) and the commit sheet are a bottom sheet below `sm` and a centred dialog
  from `sm` (`sheets/styles.ts`, pure CSS: a resize never remounts an open modal), centred on the
  column beside a docked sidebar: the `aside` carries `data-sidebar-docked`, which sets
  `--dock-width` (`index.css`, must equal its `w-72`). The filter sheet stays a right drawer.
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
  Links (`lib/terminal/links.ts`): http(s) URLs open in a new tab on click/tap, through our
  own link provider — not `WebLinksAddon`, which joins rows only on xterm's soft-wrap flag,
  and nothing from tmux ever carries it. Rows a program wrapped are joined on their bodies
  when they end at the block's measured wrap width; a marker row (`● `) takes the indent of
  the row below it. The same joined line yields markdown paths (`kind: "doc"`) when the page
  passes `openDoc` (a session with a project): they open the docs viewer, which lets the server
  decide what the path means; a `..` segment or a path inside a URL is no link. Image paths
  (`IMAGE_PATH_EXTENSIONS` in shared: png/jpeg/gif/webp, never SVG — it could script Mojito's
  origin) match by the same rule in **every** session, General too, and open `ImageViewer` over
  the terminal (pty untouched), fetched with the token header into an object URL (`apiBlob`).
  xterm's platform detection was verified correct under Vite, so v1's
  `restoreTerminalPlatform` is not ported; `platform.build.test.ts` bundles xterm with the
  app's Vite config and fails if anything starts shimming `process` (a dev warning too).
- Safe areas: `--sat/--sar/--sab/--sal` in `index.css`; every edge surface pays its inset;
  `test/safeArea.test.ts` guards it.
- **Installable app** (RIC-508): `public/manifest.webmanifest` + icons, linked from
  `index.html`. Its `id`/`start_url`/`scope` are `/`, v1's: the Mac's Safari Dock app was
  installed from v1's manifest at `http://localhost:8700/`, and a changed id strands it.
  No service worker (useless offline, and a cache would fight a deploy). The PNGs were
  rasterized from `icon.svg` by v1's `gen-icons.sh` (not ported): redraw → regenerate by
  hand. `test/manifest.test.ts` guards the id and that every listed icon exists — a renamed
  one silently un-installs the app in Chromium.
- Copy is English, like everything else (code, comments, server messages, agent
  prompts); the only Italian left is the create-ticket agent's output (tickets on Linear).
  Only Tailwind utilities + shadcn components; icons are lucide with `size`.

## Commands

```bash
pnpm dev                       # server (tsx watch, :3100, ~/.local/state/mojito-dev) + Vite (:5173, proxies /api and /ws)
pnpm test && pnpm typecheck
pnpm build                     # apps/web/dist + apps/server/dist/main.js
make deploy                    # from ~/code/mojito: pull (if tracked), frozen install,
                               # build, restart mojito, wait for /api/health
make install-service           # copy deploy/mojito.service, enable, (re)start
journalctl --user -u mojito    # logs
```

On macOS the same two targets drive the `com.mojito.server` LaunchAgent through
`deploy/launchd.sh`, which rewrites the plist on every restart: launchd gives a job no PATH
or locale, so both are baked from the calling shell, and node must be the one `pnpm install`
just built node-pty/better-sqlite3 against. Logs: `~/Library/Logs/Mojito/mojito.log`.

The tmux integration test drives a real tmux with `mj-test-*` sessions and can be flaky
under load — re-run it alone before believing a failure. Never let a test touch other tmux
sessions: the box runs live agents.
