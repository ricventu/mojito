# Project stacks: start/stop/logs from the Mojito UI — design

2026-07-22

## Problem

Projects like Factorybook have a dev stack (backend + webapp + landing) that must be
running to test tickets. Today it is started by hand (`fb-start` on the server, terminal
tabs on the Mac). The user wants per-project start/stop buttons in the Mojito UI, with
logs visible from the browser, working the same on the Mac dev instance and on the
cloud server.

## The contract (repo side)

A project opts in by committing an executable **`scripts/start.sh`** at its repo root
(path resolved from `lime-projects.json`, the map Mojito already loads). The script:

- may run an idempotent bootstrap first (install deps, seed DB — like fb-start does);
- then runs the dev stack **in the foreground**, logs on stdout (for multi-app stacks:
  `npx concurrently` with named prefixes, docker-compose style);
- is generic — it must work standalone in any terminal; nothing in it references
  Mojito. Stopping is killing the process; there is no `stop.sh`.

No `scripts/start.sh` → the project simply shows no stack controls.

## Server module — `src/server/projectStack.ts`

- `listStacks()` — `listMappedProjects()` filtered to projects whose
  `<repo>/scripts/start.sh` exists and is executable; each with its runtime status.
- Session naming: `stack-<slug>` where slug is the project name slugified. The `stack-`
  prefix is deliberately distinct from `mojito-` (reserved: boot recovery reconciles
  `mojito-*` sessions against the ticket registry).
- `startStack(project)` — `tmux new-session -d -s stack-<slug> -c <repo>
  'bash -lc "scripts/start.sh"'`, then set `remain-on-exit on` so a crashed stack keeps
  its output readable. Login shell so mise shims / PATH apply (same reasoning as
  fb-start).
- `stopStack(project)` — `tmux kill-session -t stack-<slug>`.
- Status: no session → `stopped`; session with live pane → `running`; session whose
  pane is dead (`remain-on-exit` kept it) → `crashed`.
- All tmux calls via execFile (no shell interpolation of project names); slug is the
  only user-derived input and is sanitized to `[a-z0-9-]`.

## API — `src/app/api/stacks/…`

Same conventions as the other routes (`getConfig()` + `tokenFromHeaders` → 401).

- `GET /api/stacks` → `{ stacks: [{ project, slug, status }] }`
- `POST /api/stacks/[slug]/start` → 200 `{ status }` | 404 unknown/no start.sh | 409 if
  already running
- `POST /api/stacks/[slug]/stop` → 200 `{ status }` | 404 | 409 if not running

## UI

Compact "Stacks" panel on the main page: one row per stack-enabled project — status dot
(running / stopped / crashed), start/stop button, **logs** button. Logs open the
`stack-<slug>` tmux session in the existing web terminal (ptyGateway), the same viewer
used for lime sessions. Identical on Mac and server.

**Status at a glance is the primary need** (2026-07-22: the user starts stacks on
demand and wants to see immediately which are up without ssh). The panel must show
current status on page load without interaction; refresh via the existing events
channel or light polling of `GET /api/stacks`.

tmux gotcha learned in the field: `set-option -t <session> remain-on-exit` applies to
the current window only — a crashed window then vanishes silently instead of leaving a
dead pane, and `crashed` becomes undetectable. Set the option **window-scoped** right
after creating the session (the start.sh wrapper session has one window, but the test
suite must cover it).

## Error handling

| Case | Surface |
| --- | --- |
| No token | 401 (existing pattern) |
| Project without start.sh | not listed; POST → 404 |
| start.sh crashes | status `crashed`, output readable via logs (remain-on-exit) |
| Double start / stop when stopped | 409, UI disables the button on current status |
| Mojito restart | stacks live in the shared tmux server, untouched (same isolation as lime sessions in the keeper) |

## Testing

- `tests/server/projectStack.test.ts` — fs/execFile mocked: listing filters on
  executable start.sh; slug sanitization; start/stop invocations; status mapping
  (none/live/dead pane); double-start guard.
- Route tests per the existing pattern: 401 without token, 404 unknown slug, 409
  wrong-state transitions, response shapes.

## Adoption note (Factorybook, GestionaleCooperativeMvp)

Both repos already ship a manual tmux launcher (`scripts/fb-start` → session `fb-dev`,
`scripts/gc-start` → session `gc-dev`, symlinked into /usr/local/bin on the server).
Each needs a `scripts/start.sh` implementing the contract: reuse the launcher's
idempotent bootstrap, then run the stack in the foreground (`npx concurrently` of
backend/webapp/landing for factorybook; `composer dev` is already foreground for
gestionale). The launchers stay for manual use; both must not run at the same time as
the Mojito-managed stack (same ports).

Factorybook's start.sh must keep the Next heap caps
(`NODE_OPTIONS=--max-old-space-size=1024` on webapp and landing): an uncapped
`next dev` was OOM-killed on the 4GB cloud box.

## Out of scope

- Per-worktree/per-branch stacks (the stack runs from the repo path mapped in
  `lime-projects.json`; a different branch means checking it out there or using
  fb-start manually).
- Stopping/restarting a single app within a stack.
- Log persistence/streaming beyond the live tmux view.
