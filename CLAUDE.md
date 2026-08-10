# Mojito

Mojito is a Next.js + TypeScript app (GUI + local server) that manages Linear tickets
per project and runs them through a collapsed lifecycle:
`Backlog/Todo → In Progress → To QA → Done`.

Mojito owns the whole lifecycle — there is no external plugin:

- **Prompts**: `src/server/prompts.ts` builds the full session prompt (work phase,
  conflict resolution) from templates in `src/server/prompts/`. Sessions are spawned as
  detached tmux sessions running `claude … '<prompt>'`.
- **Linear**: `src/server/linear.ts` is a direct GraphQL client. Mojito writes issue
  creation, status transitions, and assignee — never comments. **Spawned sessions never
  touch Linear** (no MCP, no API); their prompt forbids it.
- **Session context**: the launcher writes `<stateDir>/context/<id>.json`
  (`{identifier, statusName, title, project, labels, description, assets?, attachments?,
  rejectReason?}`); the prompt embeds the path. `assets`/`attachments` point at files
  Mojito already downloaded into the sibling `<stateDir>/context/<id>-assets/` directory,
  since the spawned session holds no Linear credential of its own.
- **Outcome channel**: the session's last action is writing
  `<stateDir>/results/<id>.json` (`{outcome: "ready-for-qa" | "blocked", notes}`).
  The Stop hook reads it (`src/server/hookHandler.ts`) and Mojito moves the status.
- **QA gate**: approve runs the server-side rebase+merge (`src/server/merge.ts`,
  zero tokens on the clean path; a Claude session only on conflict); reject launches
  the rework session with the reason in its context file.
- **Status model**: `src/server/statusModel.ts` is authoritative; `src/lib/status.ts`
  mirrors it for presentation and a sync-guard test ties them together. Work-phase
  sessions share a single tmux id `mojito-<ticket>-work` across Backlog/Todo/In
  Progress (see `tmuxName` in `src/server/sessionKey.ts`); the conflict session is
  `mojito-<ticket>-conflict`.
- **Projects map**: `~/.config/mojito/projects.json` (Linear team key → project name →
  repo path), resolved by `resolveProjectsPath` in `src/server/config.ts`: env
  `MOJITO_PROJECTS` → `~/.config/mojito/projects.json`.

## Tests

`npx tsc --noEmit && npx vitest run` — server logic lives under `src/server/`, tests under
`tests/server/`. The tmux integration test is skipped when `tmux` is unavailable.
