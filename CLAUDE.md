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
- **Linear**: `src/server/linear.ts` is a direct GraphQL client. Mojito writes issue
  creation, status transitions, and assignee — never comments. **The prompts say nothing
  about Linear to the spawned session** (RIC-184) — no ban, no permission. It used to ban
  Linear outright, which killed the follow-up tickets that surface mid-session; an explicit
  permission was tried next and was worse, since it had sessions opening tickets without
  asking. With no instruction the session behaves like any other: it proposes, the user
  confirms. `tests/server/prompts.test.ts` fails on either polarity creeping back. Nothing
  needs enforcing anyway — `setIssueStatus` writes the target state unconditionally, so
  Mojito's move is last-write-wins whatever the session did.
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
- **Status model**: `src/server/statusModel.ts` is authoritative; `src/lib/status.ts`
  mirrors it for presentation and a sync-guard test ties them together. Work-phase
  sessions share a single tmux id `mojito-<ticket>-work` across Backlog/Todo/In
  Progress/To QA (see `tmuxName` in `src/server/sessionKey.ts`), so a session relaunched
  while the ticket sits at the gate takes its predecessor's id; the conflict session is
  `mojito-<ticket>-conflict`.
- **Projects map**: `~/.config/mojito/projects.json` (Linear team key → project name →
  repo path), resolved by `resolveProjectsPath` in `src/server/config.ts`: env
  `MOJITO_PROJECTS` → `~/.config/mojito/projects.json`.

## Tests

`npx tsc --noEmit && npx vitest run` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable.
