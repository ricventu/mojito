# Mojito

Mojito is a Next.js + TypeScript app (GUI + local server) that manages Linear tickets
per project and runs them through a collapsed lifecycle:
`Backlog/Todo → In Progress → To QA → Done`.

Mojito owns the whole lifecycle — there is no external plugin:

- **Prompts**: `src/server/prompts.ts` builds the full session prompt (work phase,
  conflict resolution) from templates in `src/server/prompts/`. Sessions are spawned as
  detached tmux sessions running `claude … '<prompt>'`. The work prompt carries only
  Mojito's two channels — the context file it reads, the result file it writes; no phase
  sequence, no skills, no worktree rule. Which skills to use, how much design up front,
  and whether the work takes a branch at all is the session's call, same as a hand-started
  session. The asset paragraph (`src/server/prompts/work.ts`) is interpolated only when
  the launch actually downloaded something.
- **Linear**: `src/server/linear.ts` is a direct GraphQL client. Mojito writes status
  transitions and assignee — never comments, and no longer issue creation (see **New
  ticket** below; `createIssue` is gone). **The prompts say nothing about Linear to the
  spawned session** (RIC-184) — no ban, no permission. It used to ban
  Linear outright, which killed the follow-up tickets that surface mid-session; an explicit
  permission was tried next and was worse, since it had sessions opening tickets without
  asking. With no instruction the session behaves like any other: it proposes, the user
  confirms. `tests/server/prompts.test.ts` fails on either polarity creeping back. Nothing
  needs enforcing anyway — `setIssueStatus` writes the target state unconditionally, so
  Mojito's move is last-write-wins whatever the session did.
- **New ticket**: the sheet takes a note and images, not a title — `POST /api/tickets`
  uploads the images to Linear itself (the API key never leaves the server, and those
  URLs sit behind Linear's file auth), writes the raw note plus the resulting URLs to
  `<stateDir>/drafts/<random>.json` (`ticketDraft.ts`), and launches an **intake session**
  (`launchIntakeSession`) that reads that draft, rewrites it, titles it, and creates the
  issue *itself* through the Linear MCP. It is a plain custom session — no ticket, no
  launch context, no result file — because the issue it creates is the whole outcome;
  Sonnet at medium effort is inlined there, since no status names this work. Ticket copy
  goes out in Italian whatever the note was written in. This is the one deliberate
  exception to the silence above: `prompts/intake.ts` is the only prompt that mentions
  Linear on purpose, which is why the RIC-184 guard in `tests/server/prompts.test.ts`
  runs over the work and merge-fix prompts only. Nothing needs a confirmation step — the
  MCP write raises Claude Code's own permission prompt, and the sheet lands the human in
  that terminal (201 answers with the session meta) so they see it.
- **Worktrees**: a ticket launch resolves its worktree first via the legacy branch-name
  scan (`resolveWorktree`, any worktree whose branch carries the ticket id, wherever it
  lives), then the fixed `.claude/worktrees/<ticket>-<slug>` path Mojito itself creates
  (`worktree.ts`). When neither exists, the launch sheet — via
  `GET /api/tickets/[id]/worktree-status` — asks the human whether to create one and from
  which base branch; "no" opens in the repo root and asks again next launch, same as
  before this existed. Creation (`createTicketWorktree`) is a plain `git worktree add`
  Mojito runs itself, never delegated to the session — separate from the work prompt's
  continued silence on branches (the "no worktree rule" above is about what the *prompt*
  tells the session, not what Mojito does before spawning it). If the repo has
  `scripts/init-worktree.sh`, Mojito runs it once inside the fresh worktree; if not,
  or if either step fails, the launch is never blocked — a warning is echoed as the first
  line of the session's own terminal instead. A project's Stacks panel has a "Create
  worktree script" action that opens a plain Claude session in the project root to write
  that script.
- **Session context**: the launcher writes `<stateDir>/context/<id>.json`
  (`{identifier, statusName, title, project, labels, description, assets?, attachments?}`);
  the prompt embeds the path. It exists to save the session the tokens of
  re-reading Linear, not to fence it in. `assets`/`attachments` point at files
  Mojito already downloaded into the sibling `<stateDir>/context/<id>-assets/` directory,
  since those URLs sit behind Linear's file auth.
- **Outcome channel**: at the end of every round — not just once — the session writes
  `<stateDir>/results/<id>.json` (`{outcome: "ready-for-qa" | "merged"}`), a bare status
  signal with no notes. The Stop hook reads it (`src/server/hookHandler.ts`) and Mojito
  moves the status.
- **QA gate**: approve runs the server-side rebase+merge (`src/server/merge.ts`,
  zero tokens on the clean path; a Claude session only on conflict). When there is
  nothing to merge — the branch already landed outside Mojito, or the checkout holding
  the work sits on the default branch (`hasNothingToMerge` in
  `src/server/ticketMergeState.ts`) — the gate offers `mark-done` instead, which writes
  Done straight and runs no git. That answer always comes from git: anything undecidable
  (no resolvable main checkout, a failing git call) answers "there IS something to merge",
  because a wrong `true` writes Done over unmerged commits. There is no reject:
  a ticket that fails QA is reworked by typing into its still-live work session, and the
  ticket parks at To QA meanwhile.
- **Session lifetime**: Mojito never ends a session by itself. The only path that closes
  one is an explicit user action — `DELETE /api/sessions/[id]` → `closeSession`, behind the
  Kill button. Automatic paths (a QA verdict, a relaunch from the sheet) may drop only the
  *registration* of a session whose tmux is already gone, via `retireDeadSession`
  (`src/server/retireSession.ts`); a launch that finds the tmux name still held answers 409
  and tells the user to kill it first. This replaced `supersedeSession`, which closed the
  ticket's work session on every verdict — killing mid-turn the very session the gate's
  rework loop depends on. `tests/server/retireSession.test.ts` and the "never closes a
  session" case in `tests/server/verdictRoute.test.ts` fail if that comes back.
  `closeSession` asks and never forces: Ctrl-C, then Ctrl-D *re-sent on every poll* —
  claude answers the first one with "Press Ctrl-D again to exit", so a single EOF left
  it running until the wait was up and the session was then torn down under a live
  claude, losing whatever it had not written out. There is no `kill-session` fallback
  at all now: a session claude will not leave answers 409 and keeps its tmux, its
  registration and its card, and both call sites surface that refusal
  (`src/lib/dismissSession.ts`) rather than swallowing the status, which used to make a
  refused dismiss look exactly like a successful one. The real-tmux cases in
  `tmux.integration.test.ts` cover both halves — a process that wants a second Ctrl-D,
  and one that ignores every signal.
- **Child environment**: nothing Mojito spawns inherits `process.env` — every spawn goes
  through `sanitizeEnv`/`spawnEnv` (`src/server/childEnv.ts`). Mojito's own environment is
  not a neutral base: `npm start` runs `cross-env NODE_ENV=production`, adds npm's `npm_*`
  block and prefixes PATH with Mojito's own `node_modules/.bin` chain, and `loadEnvConfig`
  then layers `.env.local` (`LINEAR_API_KEY`, `MOJITO_TOKEN`) on top. All of it used to
  reach the shell of every agent session (RIC-207), where the damage is silent and
  destructive rather than cosmetic: under `NODE_ENV=production` a bare `pnpm install`
  *deletes* a workspace's already-installed devDependencies and exits 0. Two layers, both
  needed — the sanitized `env` on the spawn covers a tmux server Mojito itself starts, and
  `tmuxEnvArgs` adds session-scoped `-e` overrides for what a *pre-existing* tmux server
  still leaks globally (that server outlives Mojito and hands its global environment to
  every session created afterwards). Overrides are emitted only for keys actually leaking,
  so a clean server keeps them genuinely absent rather than pinned to `""`. `.env` keys are
  not hardcoded anywhere: `registerEnvFileKeys` in `server.ts` diffs `process.env` across
  the loader, so a credential added to `.env.local` later is scrubbed without anyone
  remembering to update a list. Covered at both ends — pure unit tests in
  `tests/server/childEnv.test.ts` and a real-tmux case in `tmux.integration.test.ts` that
  asserts a pane sees neither `NODE_ENV` nor a leaked key. Deliberately *not* extended to
  Mojito's own git/`gh`/`systemctl` calls, which no `NODE_ENV` branch touches.
- **Status model**: `src/server/statusModel.ts` is authoritative; `src/lib/status.ts`
  mirrors it for presentation and a sync-guard test ties them together. Work-phase
  sessions share a single tmux id `mojito-<ticket>-work` across Backlog/Todo/In
  Progress/To QA (see `tmuxName` in `src/server/sessionKey.ts`), so a session relaunched
  while the ticket sits at the gate takes its predecessor's id; the conflict session is
  `mojito-<ticket>-conflict`.
- **Client url state**: the address bar is the single source of truth for which view is
  open and how the list is filtered (RIC-204). `src/lib/appLocation.ts` is the pure
  codec — `parseLocation`/`formatLocation` over `/`, `/stacks`, `/session/<id>`,
  `/session/<id>/docs`, `/docs/ticket/<id>`, `/docs/session/<id>` plus the five filter
  params — and `useAppLocation` is the only `window.history` glue, so everything
  testable stays testable in the node-only vitest setup (no jsdom, no RTL; same split
  as `resolveInitialToken` ÷ `useToken`). The five `mojito-list-*` localStorage keys and
  `mojito-tab` are gone, along with `usePersistedState` itself: localStorage is shared
  between browser tabs, which is exactly what made two tabs unable to hold two filter
  sets. Consequences worth knowing: filters are serialized on *every* path, so leaving
  the list for the stacks panel and coming back does not drop them; defaults are
  omitted, so the unfiltered board is a bare `/` (and the PWA's `start_url` therefore
  always opens clean); typing in the filter box replaces the entry instead of pushing
  one per keystroke; and the page lives at `src/app/[[...view]]/page.tsx`, an optional
  catch-all, which is what makes a hard reload of `/stacks` serve the app instead of a
  404 — `/api/*` and `public/` still win as the more specific routes. That catch-all
  also matches `/ws/pty` and `/ws/events`, which is what `claimUpgrades`
  (`src/server/nextUpgrade.ts`) exists for: Next attaches an `upgrade` listener of its
  own on the first request it handles and ends any socket whose path its router
  matches — it leaves *unmatched* paths alone precisely so a custom WS server can have
  them, which is why the websockets were fine before the catch-all and black after it.
  Every terminal came up empty and every live update stopped, and the client's 1.5s
  reconnect loop turned that into the pty leak `ptyGateway` now guards against. A
  launch also seeds its answer into the session list before navigating (`withSession`),
  since an unknown `/session/<id>` corrects itself back to the board. In-app Back
  buttons step through real history when the previous entry is ours, tracked as a depth
  counter in `history.state` (`src/lib/navDepth.ts`), and fall back to a url otherwise,
  so a link opened straight into a terminal never backs out of Mojito.
- **Projects map**: `~/.config/mojito/projects.json` (Linear team key → project name →
  repo path), resolved by `resolveProjectsPath` in `src/server/config.ts`: env
  `MOJITO_PROJECTS` → `~/.config/mojito/projects.json`.

## Tests

`npx tsc --noEmit && npx vitest run` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable.
