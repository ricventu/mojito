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
`MOJITO_HOST`, and for peers `MOJITO_NAME`, `MOJITO_PEERS`. `~/.mojito-state` is the old
app's state, left in place.

## Layout

- `packages/shared` — types (`SessionMeta`, `TaskRecord`, `TicketSummary`, `BoardTickets`,
  `Settings`, `ProjectRow`, `Favorite`), zod request bodies (`LaunchBody`, `ProjectBody`, `SettingsBody`,
  `PromptsBody`, `FavoritesBody`, `StatusBody`), `MojitoEvent`, `MODELS`/`EFFORTS`, `DEFAULT_PROMPTS`,
  `SESSION_GONE_CODE` (4404), the git graph types (`GitGraphPage`, `GraphCommit`, `GraphRef`,
  `GraphHighlight`, `CommitDetails`, `CommitFile`, `CommitDiff`) and `isValidHash`/`isValidTicket`,
  `CleanResult`/`WorktreeCount`, the docs
  types (`DocEntry`, `DocList`, `DocFile`, `DOC_MAX_BYTES`) and `isDocPath`, the peer types
  (`PeerSnapshot`, `PeersAnswer`) and `openEventStream` (used by the web and by the server's peer
  links; `schedule` is required — the package has no timer typings). Consumed as source, no build; zod **4** everywhere (the Agent
  SDK's peer).
- `apps/server` — Node 22, Hono 4 on `@hono/node-server`, `ws` on the http `upgrade` event,
  `node-pty`, `better-sqlite3`. Built with tsup (`tsup.config.ts` bundles `@mojito/shared`
  — without `noExternal` the built server dies importing `.ts`).
- `apps/web` — React 19, Vite, Tailwind 4, shadcn/ui (Radix) under `src/components/ui`,
  react-router, TanStack Query, `@xterm/xterm` 6 (DOM renderer, no WebGL), lucide icons.

## Server

- **Persistence** (`src/db`): migrations are TS modules exporting SQL (`migrations/*.ts`,
  applied once each, in a transaction) — `.sql` imports break under vitest and `tsx watch`.
  Tables: `projects`, `settings` (key/value JSON), `sessions` (`hidden`, added by 003, was
  dropped by 005 with the sidebar's Hide; `end_reason`, 006; `claude_session_id`, 007), `sdk_tasks`. Tickets are never
  stored: `tickets/cache.ts` polls Linear every 45 s, scoped to the mapped project names,
  coalesces concurrent refreshes, keeps the last list (`stale`) when Linear fails.
  Projects are edited in Settings.
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
  worktree" switch (on by default in the sheet, RIC-527; `LaunchTicketBody.worktree`, absent in
  the body = off, so an API call or an older peer's forward keeps its meaning): on,
  `buildTicketPrompt` appends the fixed `WORKTREE_INSTRUCTION` (not a setting) as the last line.
  Mojito writes In Progress; the session writes In Review; Done is the human's (the ticket sheet's
  Mark Done, offered while the ticket is In Review; a live session stays, as a loose row).
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
- **Live state** comes only from Claude Code hooks (`hookSettings.ts` → curl to
  `<selfOrigin>/api/hook` — the configured host, loopback only for a wildcard bind — with
  `x-mojito-token` and claude's hook JSON as body; `hookMap.ts`, `hooks.ts`). `ended` is
  sticky for hooks. Read from the body: SessionEnd `reason: "clear"` or `"resume"` is ignored (a
  `/clear` or a `/resume` must not end a live session; verified on 2.1.318) and the SessionStart
  `source: "clear"` after it maps to idle, as does `source: "resume"` (a resumed claude waits at
  its prompt); every hook's `session_id` (a
  plain id only — it reaches a shell command) is kept as `claudeSessionId`, a change emitted;
  Notification maps to
  needs-input only for blocking types (`permission_prompt`, `elicitation_dialog`, …) — the
  ~60 s `idle_prompt` after every Stop would otherwise turn every finished session amber. A Stop
  whose `background_tasks` still lists an agent (`subagent`/`workflow`/`teammate`, never a `shell`:
  a dev server is not work) keeps the session `running` — its report starts the next turn
  (UserPromptSubmit) and the Stop after that goes idle; shown idle, a session mid-verification was
  closed as finished (verified on 2.1.316).
  `startupStall.ts` flips a session still `starting` after 20 s to needs-input (the
  workspace-trust prompt fires no hook).
- **Why a session ended** (`sessions/ends.ts`, `oom.ts`, migration 006 `sessions.end_reason`,
  `EndReason` in shared): `exited`
  (SessionEnd `prompt_input_exit`/`logout`), `other` (any other SessionEnd: a signal), `gone` (tmux
  vanished with no SessionEnd), `oom`. Each end logs `session <id> ended: <reason>` — what to grep
  in the service log. The 5 s pane poll (`paneWatch.ts`) also ends a live row tmux no longer lists
  (`gone`; only rows read *before* asking tmux, so a launch racing the poll is never reaped) — a
  claude killed outright used to show `running` until someone opened it. OOM: on Linux tmux 3.4+
  starts each pane in its own `tmux-spawn-<uuid>.scope`; `EndWatch` remembers each pane's scope
  from `/proc/<pid>/cgroup` while it lives (a failed scope is garbage-collected), and an `other`/
  `gone` end whose scope's user journal says "The kernel OOM killer killed some processes in this
  unit" within 60 s becomes `oom`. systemd's default then stops the whole scope — claude gets a
  SIGTERM, exits cleanly, and it looked like a normal close (ai-tonic, 2026-11-02) — so `make
  install-service` installs `deploy/tmux-spawn-oom.conf` (`OOMPolicy=continue`) as a drop-in for
  every pane scope. The web shows it on the badge (`lib/endReason.ts`: red for `oom`/`gone`/`other`)
  and on the ended terminal.
- **Resume** (`POST /api/sessions/:id/resume`, `launch.ts#resumeSession`): an ended claude
  session started again as `claude --resume <claudeSessionId>` (model/effort as recorded, fresh
  hook settings) under the **same id**, from the row's cwd — claude finds the id there and in the
  repo's worktrees and goes back into the worktree the session had moved to (`EnterWorktree`
  relocates the transcript, so `--resume` from the root lists nothing without Ctrl+W). New
  `createdAt` (it sorts newest, and no pane poll that read the ended row takes it for the same
  session), `endReason` cleared, Linear untouched. 404 unknown, 400 a shell or a missing cwd (an
  adopted row has none), 409 no conversation id or live (with `sessionId`); the launch lock
  answers a double tap. Not relayed to peers: their snapshot holds live sessions only.
- **Session names** (`sessions/titles.ts`, migration 004 `sessions.title`): `/rename` fires no
  hook, but claude sets the terminal title to `<glyph> <name>` — the `/rename` name, else its
  automatic title (`Claude Code` until it has one; kept across `/clear`). Every 5 s one
  `tmux list-panes -a` (`livePanes`, `paneWatch.ts`) is read; `sessionTitle` takes what follows a leading
  non-letter glyph (a shell's hostname title never matches), and a change patches the row and
  emits `session.updated`. No name keeps the last one. The web shows it for sessions without a
  ticket (`sessionName`: board rows, sidebar, terminal header); a ticket session keeps its ticket.
- **tmux** (`tmux/tmux.ts`): always **exact targets** — `=name` for sessions, `=name:` for
  panes. tmux matches `-t` by prefix, and `mj-RIC-49` is a prefix of `mj-RIC-49x`: a bare
  target once sent Ctrl-D to the wrong claude. `hasSession` answers false only when
  tmux says the session/server is not there; any other failure rejects (unreachable is not
  dead — the pty gateway then closes 1011, retryable). **No Kill**: Mojito never closes a
  session (it was removed on purpose, with `closeSession`); claude is quit in its terminal, and
  `DELETE /api/sessions/:id` only forgets an **ended** row (409 for a live one). New sessions start in a
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
  first. Ping/pong heartbeat reaps half-open phone sockets. `/ws/peers/<name>/pty/<id>` is the
  same terminal on a peer, relayed (`ws/peerPty.ts`; `UpgradeDeps.peers`, absent → destroyed): an
  unknown peer is destroyed, a known peer with an id that is no `mj-` id (empty, nested,
  undecodable too) is answered 4404 — the client's `exitAction` then goes to the board instead of
  redialling forever — an offline peer is answered 1011 (the client's
  backoff re-attaches), otherwise this instance dials the peer's `/ws/pty/<id>` with the shared
  token **before** completing the browser's handshake (a dial failure → 1011); if the browser
  leaves mid-dial the dial is aborted and the socket destroyed — a handshake completed on a dead
  socket crashed the server once; a late upstream is closed under a no-op `error` listener, and so
  is one whose browser handshake `ws` rejects (it answers 400 without calling back). Frames pipe both ways with their type kept. **Close-code rule**:
  1000 and 3000-4999 are mirrored (`SESSION_GONE_CODE` 4404 must reach the browser intact or its
  reconnect loop retries a gone session forever), anything else (1005/1006, 1001) becomes 1011;
  the peer side is pinged every 30 s (a sleeping Mac sends no close).
- **HTTP** (`http/`): all `/api/*` except `/health` need `x-mojito-token`; error bodies are
  always `{ error }`; `POST /api/sessions` → 201 `{session, warning?}` or `{error, sessionId?}`.
  Static web build served with SPA fallback (never for `/api` or `/ws`). Listen errors exit 1.
- **Files for a session** (`POST /api/sessions/:id/images`, `sessions/images.ts`; RIC-541): images
  and PDFs. claude's own image paste reads the server's clipboard, never the browser's, so the
  client uploads and pastes the returned absolute paths; claude turns an image into `[Image #N]`
  and reads a PDF. `validateAttachments` is the session's own check (≤ 10 files, ≤ 10 MB each;
  images by type, a PDF by type or extension, since `File.type` may be empty); `validateImages`
  stays for what reaches Linear, so the New-ticket sheet takes images only. Stored in
  `<stateDir>/images/<id>/` (0700/0600), never the repo; a PDF as `<safe name>-<hex>.pdf` (pasted
  paths are space-separated, and the name helps claude), an image under a random name; the
  extension never comes from the client's name. The body is read before any refusal: answered
  mid-upload, a browser can report a bare network error instead of it. Route and folder keep
  their names so an older peer still takes images; its 400 on a PDF reaches the user. claude attaches a pasted image path
  outside its cwd without a permission prompt and downscales big ones itself (both verified on
  2.1.312), hence the shared 10 MB cap. A PDF's path is text it must Read, which outside the
  project prompts: `buildHookSettings` allows `Read` of that session's folder only, so it applies
  from the next launch or resume (verified on 2.1.318, Mac and box, no `pdftotext` needed). Office
  files were left out on purpose: Read refuses them and claude needs the shell, which prompts
  (`.xlsx`/`.docx`/`.xls`/`.doc` all read fine once approved, on both machines). Deleted with the row
  (`DELETE /api/sessions/:id`, an ended one only).
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
- **Clean** (RIC-528, `POST /api/projects/:name/clean` → `CleanResult`, `launchClean`): a Claude
  session, not git commands — "merged" must include squash and rebase merges, which `git branch
  --merged` does not see. Fixed id `mj-<slug>-clean` (a live one answered `alreadyOpen`, like the
  git session; both go through `launchProjectSession`), sonnet/high, the fixed `CLEAN_PROMPT` (not
  a setting): fetch --prune, list merged local and origin branches and the worktrees of merged
  branches, never touch the default/checked-out branch, unmerged commits, a locked worktree (a live
  Claude Code session holds it) or a dirty one, **wait for the human's yes in the terminal**, then
  `worktree remove` (no --force), `branch -d`, `push origin --delete`, `worktree prune`. The badge:
  `GET /api/projects/:name/worktrees` → `{count}` (`git/worktrees.ts`: porcelain entries minus the
  main checkout and `prunable` ones; a `GitError` is a 409).
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
  task's team/project, at most one issue per task; the starting status (`INITIAL_STATUSES`: Todo,
  the default, or Backlog — the sheet's toggle, `input.initialStatus`, a task stored before it reads
  Todo) is bound the same way and is no tool parameter; a task that created its issue is `done`
  even if the stream throws afterwards (retry must not duplicate). Images are validated
  (png/jpeg/gif/webp, ≤10, ≤10 MB) and uploaded to Linear **before** the task row exists.
- **Peers** (`peers/`, `http/routes/peers.ts`; spec `2026-10-31-mojito-peers-design.md`): other
  Mojito instances (the Mac, this box) whose live sessions every client shows. `MOJITO_PEERS` is
  a comma-separated list of their URLs; a peer's name is the first DNS label of its host (the
  whole hostname for an IP or a dotless host), a duplicate or a non-http(s) URL fails boot.
  `MOJITO_NAME` names this one (default: the hostname up to its first dot) — set it to the tailnet
  machine name so every client calls a machine the same. **All instances share one
  `MOJITO_TOKEN`**: each would hold the other's anyway, and it is what lets a client open a peer
  through the `?token=` handoff with the token it already has. `PeerLink` (one per peer, never
  awaited at boot) dials the peer's `/ws/events` with the shared backoff, pings it every 30 s
  (a sleeping Mac sends no close), reads `/api/sessions|projects|tickets` (10 s each) on every
  open, then patches the snapshot from `session.*`, `tickets.changed`, `projects.changed`
  (emitted by `projectRoutes`); each change is `peers.updated` on the local bus. A close
  empties the snapshot: offline shows no sessions. A failed read closes the socket after
  `retryDelay(failures in a row)` — the stream's backoff restarts on every open, so a peer that
  opens but cannot be read would otherwise be re-dialled every second. A bad-token ws upgrade is
  answered `401` (not just destroyed), so the dialling side logs "token rejected (401)"; a link
  logs one line per offline stretch.
  No echo: a peer's `/api/sessions` is only its own. Paths never leave a peer in the snapshot
  (names only); the in-place relay below does carry them — image upload answers the peer's
  absolute paths to the browser, and the viewer, docs and git calls send paths back.
  `GET /api/peers` → `{self, peers}`; `POST /api/peers/:name/sessions` forwards a `LaunchBody`
  and answers the peer's status/body verbatim (offline/unreachable/non-json 502, no answer in
  30 s → 504 "may still be starting"). Besides that launch, a peer's session opens **in this
  client** (spec `2026-11-02-peer-sessions-in-place-design.md`), so the browser only ever talks to
  this instance: an **allowlisted** HTTP relay, `/api/peers/:name/<rest>` (`peers/relay.ts`,
  `matchRelay` + `relayRequest`), and the pty relay above. The table is image upload
  and view, the git graph/commit/diff, the docs list/file — nothing else (not settings, hooks, projects; no DELETE either: there is no Kill, and a peer's
  rows are forgotten on the peer): off the table is 404, so a client bug
  cannot write a peer's settings. Each segment is decoded and must be one plain name (no
  `.`/`..`/`/`); the literal segments are matched verbatim and only the `:param` slots are
  re-encoded into the peer URL; the body is streamed (never parsed, the peer
  validates it), the response comes back verbatim with only `content-type|length`, `nosniff`,
  `CSP` and `cache-control` (the viewer's `CSP: sandbox` survives the hop); offline → 502 without
  trying, no answer in 30 s → 504 (the limit is the peer's headers: it is cleared once they
  arrive, so a slow upload or download is never cut); only `x-mojito-token` and the request's
  `content-type` go to the peer. Ids are unique per
  instance only (`mj-<slug>-git` exists on every instance with that project): the host is always
  part of an address.
  Mac setup: `tailscale serve --bg 8700`, the same `MOJITO_TOKEN`, each instance listing the
  other in `MOJITO_PEERS`.

## Web

- Pure logic lives in `src/lib` and is unit-tested in node (no jsdom); components are glue.
- `lib/eventStream.ts` + `hooks/useEvents.ts`: refetch everything on each ws connect and on
  `visibilitychange`; events patch the query cache.
- Board (`lib/board.ts` → `components/board`): one section per project, In Review → In
  Progress → Todo, Backlog collapsed; free sessions and sessions whose ticket is no longer on
  the board stay visible as loose rows (a live tmux never disappears from the UI). A "Created"
  task card (`TaskStrip`) opens its ticket's sheet like a ticket card, its id the link to Linear;
  until the ticket is on the board (`taskTicket`: the poll after creation; closed since) only the link.
  A ticket's status is a filled pill (`StatusBadge`): violet In Review, blue In Progress, neutral
  otherwise — emerald, sky, amber and red mean a session's state.
- Project header: Pull / Push icons (`GitButtons`, `lib/gitSync.ts`) — a toast, or on a conflict
  the git session's terminal (pushed, from the board). Then Clean (`CleanButton`, `lib/clean.ts`):
  opens the clean session's terminal; its badge is the linked worktree count (hidden at 0, `9+`),
  `worktreeKey(project)` under `qk.worktrees` (re-read on reconnect) with a 30 s `refetchInterval`
  — worktrees come and go with sessions, which emit nothing about them.
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
- **Board filters** (RIC-502): project (multi), status, active sessions (`live=1`, RIC-549: a
  ticket with a live session, a live loose session), text — the url is the only state
  (`lib/filters.ts` codec, `hooks/useBoardFilters.ts`). Writes **replace** the history entry
  (Back leaves the board, not one chip). `q` keeps its spaces in the live url (trimming would
  eat the space typed between two words); `canonicalSearch` trims it, and favourites are saved
  in and compared by that form. Its projects sort with plain `sort()`, never the device's
  locale (favourites compare as strings across devices); display order (sections, sidebar,
  sheet) is `byProjectName`, `localeCompare(b, "en")`. The search field keeps a local draft: react-router 8 applies
  navigations asynchronously in a transition, so a url-controlled input loses caret and
  keystrokes. `filterBoard` runs after `groupBoard`: a project filter drops General, a status
  filter drops loose sessions and statuses outside `FILTER_STATUSES` (workflow order, Backlog →
  In Review, the sheet's and the url's; a favourite saved in another order still matches, being
  re-canonicalised); Backlog opens (`backlogOpen`) when selected or `q` or `live` is set, so a
  filter never hides a match in a closed group. `lib/boardReturn.ts` keeps the last board search in `sessionStorage` (per tab) for the
  terminal's Board link, best effort.
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
  `[var(--dock-width)]`, guarded by `safeArea.test.ts`). `AppShell` also holds the New ticket
  sheet (`useNewTicket`): the board, the sidebar header's + and the terminal header's + open the
  same one, preselecting the on-screen session's project when this instance maps it (the task
  runs here, a peer's session too). Every
  non-`ended` session, unfiltered by the board, grouped by project (General last), newest
  `createdAt` first — only immutable keys, so rows never jump when a state changes. No Hide:
  it was removed (a session leaves the sidebar when it ends; ended ones stay on the board, at
  the bottom of their project, until removed — never in the sidebar, by the human's choice).
  Resume (`hooks/useResume.ts`, `canResume`: ended, not a shell, a `claudeSessionId`) is on the
  ended terminal, the board's loose row and the ticket sheet (beside a fresh Launch); this
  instance only.
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
- **Peers in the web** (`lib/peers.ts`, `hooks/usePeers.ts` under `qk.peers`, patched by
  `peers.updated`): with peers every instance gets a band (`HostSection`), this one first, each
  peer after it (`PeerSection`) — the band is the top tier (uppercase name, session count,
  `sticky` so a row's host is always on screen), project headings the middle one. Hosts carry no
  status dot (a dot always means a session's state): an offline peer is its band alone, dimmed,
  "· offline". A peer's row is an in-app `<Link>` to `/session/<id>?host=<peer>` like a local
  one (`isCurrent` compares host **and** id); only what belongs to the machine leaves the client:
  the band's ↗ opens the peer's own client (`peerHref`, `?token=` handoff) in the **same tab**
  — a plain link, Back returns — to reach its board, Pull/Push, launches and Settings (in an
  installed web app another origin is out of scope, so the platform may open the browser; not
  ours to fix). No instance menu. Without peers there are no bands, the list is this
  instance's projects. `SidebarToggle` carries an amber dot when a peer has a session
  waiting; the board and its waiting pill stay local. The ticket sheet's "Run on"
  (`launchHosts`: this instance, then online peers mapping the ticket's project) shows only with
  more than one host; a peer launch navigates in place to the session once the forward answers
  (a 409 with `sessionId` too) — there is no tab, so no `window.open` dance. The new-session sheet has
  the same "Run on" (`freeLaunchHosts`): its Project list is this instance's projects and every
  online peer's (`freeLaunchProjects`), the hosts are those mapping the picked one (General: all
  online), and it shows with a choice or when the only host is a peer. A
  ticket already running on a peer (`peerSessionForTicket`) shows "Session on <peer>" and an
  in-app Open link instead of the Launch form: the board is local, and a Launch would start a
  second agent on the same ticket.
- **A peer's session in this client** (`lib/host.ts`, `hooks/useHost.ts`, `lib/peerSession.ts`):
  `/session/:id`, `/git/:project` and `/docs/:project` take `?host=<peer>`, absent = this instance
  (the git/docs codecs keep `host` as written and every in-page link carries it). **`host` is
  never resolved to this instance unless it equals `self`** — `resolveHost` waits for
  `/api/peers` (loading), then self / peer / unknown; otherwise a renamed peer's old url
  `/session/mj-mojito-git?host=192.168.1.5` would open the local `mj-mojito-git`.
  Unknown: the session page goes to the board, git/docs show "Unknown host". While loading,
  `pageSession` never shows this instance's row for the id. **`hostApi(host, path)` is the one
  way to address a host** (`ptyPath`, `sessionHref` likewise): a peer's call becomes
  `/api/peers/<host>/…`; `apiFetch`/`apiBlob` are unchanged, and `gitKeys`/`docKeys` take the
  host (a project name may exist on both machines). The peer's snapshot holds live sessions only,
  so it never sends the reader away: **the pty is the authority** — the page keeps the last-known
  row for host+id, the relay's 4404 shows "Session ended", and a 4404 on a cold load (nothing
  seen: a stale link) goes to the board (`exitAction`); an offline peer keeps the page
  ("<peer> · offline", the terminal reconnects). The terminal header names the host. Image upload/viewer,
  `.md` paths and the header's Git and Docs all go through `hostApi` and carry `host`; no Pull/Push or other project action appears for a peer. The board stays local: its
  toolbar `<h1>` and the tab title (`appTitle`, `<self> · Mojito`) name this instance (`self` of
  `/api/peers`, "Mojito" until it answers), so after a band's ↗ it is plain whose board it is.
- **Desktop first, phone complete.** The board column is `max-w-6xl`, an `@container`: from
  `@2xl` (by its own width, which a docked sidebar narrows) each project's active tickets are
  kanban columns Todo → In Progress → In Review (`kanbanColumns`: all three even when empty, so
  they line up across projects; "Other" only for a custom status; a status filter keeps only its
  columns), with Backlog collapsed; under it, the phone's list. Both are rendered and CSS picks one
  (nothing to measure, no jump). Loose sessions are one plain list at every width
  (`LooseSessions`, `splitLoose`): live first, then an "Ended N" group whose "Remove all" (two
  taps) forgets them all; each row's time carries its day (`startedLabel`). The board's modals (ticket,
  new ticket, new session) and the commit sheet are a bottom sheet below `sm` and a centred dialog
  from `sm` (`sheets/styles.ts`, pure CSS: a resize never remounts an open modal), centred on the
  column beside a docked sidebar: the `aside` carries `data-sidebar-docked`, which sets
  `--dock-width` (`index.css`, must equal its `w-72`). The filter sheet stays a right drawer.
- Overlay sheets (filter, sidebar) draw their own ✕ (`showCloseButton={false}`): shadcn's
  built-in one is absolutely positioned and ignores the safe-area insets.
- Terminal (`components/terminal`, `lib/terminal`): `syncGeometry` always publishes the size,
  re-fit refused while the iOS keyboard is up; accessory bar (coarse pointers only), composer
  (`term.paste`, no CR — do not turn it into a paste box), buffer copy in a `<pre>`.
  Files (`lib/terminal/attachments.ts`): a paste with files and no text (capture phase on
  the holder, ahead of xterm), a drop, or the accessory bar's picker (exact image types, so iOS
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
  No service worker (useless offline, and a cache would fight a deploy). A running page keeps its
  build, and iOS resumes an installed app with no reload button: the server sends the page
  `cache-control: no-cache`, and on each ws connect and return to the foreground `useEvents` compares
  its entry script's hashed name with the served page's (`lib/appUpdate.ts`), offering Reload in a
  toast — never reloading by itself, which would lose a half-typed ticket. The PNGs were
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
