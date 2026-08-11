# Mojito

Mojito is a Next.js + TypeScript app (GUI + local server) that manages Linear tickets
per project and runs them through a collapsed lifecycle:
`Backlog/Todo → In Progress → To QA → Done`.

Mojito owns the whole lifecycle — there is no external plugin:

- **Prompts**: `src/server/prompts.ts` builds the full session prompt (work phase,
  conflict resolution) from templates in `src/server/prompts/`. Sessions are spawned as
  detached tmux sessions running `claude … '<prompt>'`.
- **Linear**: `src/server/linear.ts` is a direct GraphQL client. Mojito writes issue
  creation, status transitions, and assignee — never comments. **The prompts say nothing
  about Linear to the spawned session** (RIC-184) — no ban, no permission. It used to ban
  Linear outright, which killed the follow-up tickets that surface mid-session; an explicit
  permission was tried next and was worse, since it had sessions opening tickets without
  asking. With no instruction the session behaves like any other: it proposes, the user
  confirms. `tests/server/prompts.test.ts` fails on either polarity creeping back. Nothing
  needs enforcing anyway — `setIssueStatus` writes the target state unconditionally, so
  Mojito's move is last-write-wins whatever the session did.
- **Session context**: the launcher writes `<stateDir>/context/<id>.json`
  (`{identifier, statusName, title, project, labels, description, assets?, attachments?,
  rejectReason?}`); the prompt embeds the path. It exists to save the session the tokens of
  re-reading Linear, not to fence it in. `assets`/`attachments` point at files
  Mojito already downloaded into the sibling `<stateDir>/context/<id>-assets/` directory,
  since those URLs sit behind Linear's file auth.
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
