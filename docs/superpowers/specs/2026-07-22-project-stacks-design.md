# Project stacks: start/stop/logs/pull from the Mojito UI — design

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

- `listStacks()` — **every** project in `listMappedProjects()`, each flagged `hasStack`
  (an executable `<repo>/scripts/start.sh` exists) and, when `hasStack`, its runtime
  status. Projects without `start.sh` are still listed — as pull-only rows (see
  Pull & resolve below) — but expose no start/stop/logs.
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

- `GET /api/stacks` → `{ stacks: [{ project, slug, hasStack, status }] }` (`status` is
  meaningful only when `hasStack`, else `null`)
- `POST /api/stacks/[slug]/start` → 200 `{ status }` | 404 unknown/no start.sh | 409 if
  already running
- `POST /api/stacks/[slug]/stop` → 200 `{ status }` | 404 | 409 if not running
- `POST /api/stacks/[slug]/pull` → 200 `{ status, from, to }` | 409 `diverged` | 500
  `failed` | 404 unknown slug (see Pull & resolve)
- `POST /api/stacks/[slug]/resolve` → 201 `{ meta }` | 404 unknown slug (see Pull & resolve)

## UI

Compact "Stacks" panel on the main page: **one row per mapped project**. A stack-enabled
project (executable `scripts/start.sh`) shows a status dot (running / stopped / crashed),
start/stop button, and **logs** button — logs open the `stack-<slug>` tmux session in the
existing web terminal (ptyGateway), the same viewer used for lime sessions. A project
without `start.sh` shows none of those controls. **Every row**, stack-enabled or not, also
has a **Pull** button (see Pull & resolve). Identical on Mac and server.

**Status at a glance is the primary need** (2026-07-22: the user starts stacks on
demand and wants to see immediately which are up without ssh). The panel must show
current status on page load without interaction; refresh via the existing events
channel or light polling of `GET /api/stacks`.

tmux gotcha learned in the field: `set-option -t <session> remain-on-exit` applies to
the current window only — a crashed window then vanishes silently instead of leaving a
dead pane, and `crashed` becomes undetectable. Set the option **window-scoped** right
after creating the session (the start.sh wrapper session has one window, but the test
suite must cover it).

## Pull & resolve (git sync)

Independent of the stack lifecycle: keep a project's mapped checkout current from the UI.
The pull runs in the **repo root** mapped in `lime-projects.json` (not a worktree — the same
path the stack runs from), on whatever branch is checked out there. Available on every
panel row, including pull-only projects with no `scripts/start.sh`.

### Fast-forward pull

`POST /api/stacks/[slug]/pull` runs a fast-forward-only pull — the same shape as the
self-update design (`2026-07-22-self-update-button-design.md`), parameterized by cwd. A
small `ffPull(cwd)` helper in `projectStack.ts`:

1. `git rev-parse --short HEAD` (before)
2. `git pull --ff-only` (execFile, ~60s timeout, never a shell)
3. `git rev-parse --short HEAD` (after)

- Returns `{ status: "updated", from, to }` when HEAD moved, `{ status: "up-to-date",
  from, to }` when it didn't.
- Throws `FfPullError { kind: "diverged" | "failed", detail }`. `diverged` is detected from
  the `--ff-only` failure text ("Not possible to fast-forward" / "Need to specify how to
  reconcile"); anything else (network, dirty tree, not a repo) is `failed`. `detail` is a
  trimmed stderr snippet.
- Concurrency: one in-flight pull per slug (module-level map); a second POST while one runs
  returns the same result. (Mirrors self-update's single-flight; the two `ffPull`
  implementations could later be unified.)

Never an unattended merge, never a reset — a non-fast-forwardable history is surfaced, not
resolved automatically. Pulling while the stack is running is allowed; it does **not**
restart the stack (a running dev server may need a manual stop/start to pick up the new
code — auto-restart is out of scope).

### Resolve with a Claude session (on non-ff / error)

On a 409/`diverged` or 500/`failed` pull the UI offers **"Resolve with Claude"** — it does
not open automatically ("propose", per the request). Accepting it launches a Claude session
**in the project repo** to reconcile the branch, using the **model and effort configured
for the `To Merge` stage** (`defaultModelForStatus("To Merge")` /
`defaultEffortForStatus("To Merge")` from `src/server/stageDefaults.ts`, so the user's
`stage-defaults.json` overrides apply — the merge stage is the natural profile for
divergence/conflict work).

- `POST /api/stacks/[slug]/resolve` → resolves the mapped repo path, reads the To-Merge
  model/effort **server-side**, and launches via a new `launchStackResolveSession` (in
  `launch.ts`) that mirrors the **project-scoped custom** path (`kind: "custom"`, bare
  interactive `claude`, no launch-context file) with one addition: a **seeded initial
  prompt**.
- The seeded prompt is built **server-side** from a fixed template parameterized only by
  server-derived values (project name, repo path, current branch). No client-supplied
  string enters the command — the failure `detail` is not interpolated — so there is no new
  shell-injection surface (the existing single-quote escaping still applies). The prompt
  tells the session it is in `<repo>`, that `git pull --ff-only` could not fast-forward, and
  to bring the branch up to date with `origin`: fetch, inspect the divergence, rebase or
  merge as appropriate, resolve conflicts, keep local work, and do **not** force-push. The
  session runs `git` itself, so it sees the real error firsthand.
- `buildCustomClaudeCommand` gains an optional trailing `prompt`, appended as the final
  quoted arg exactly as `buildClaudeCommand` appends `slashForStatus + ticket`; a
  project-scoped custom launch with no prompt is byte-for-byte unchanged.
- Response 201 `{ meta }`; the session appears in the normal **Custom** bucket and is
  viewable in the web terminal. The UI focuses it after launch.

## Error handling

| Case | Surface |
| --- | --- |
| No token | 401 (existing pattern) |
| Project without start.sh | listed as a pull-only row; start/stop POST → 404 |
| start.sh crashes | status `crashed`, output readable via logs (remain-on-exit) |
| Double start / stop when stopped | 409, UI disables the button on current status |
| Pull can't fast-forward | 409 `diverged`; UI offers "Resolve with Claude" |
| Pull git failure (network / dirty tree / not a repo) | 500 `failed` + stderr snippet; UI offers "Resolve with Claude" |
| Resolve session | project-scoped custom `claude` in the repo, To-Merge model/effort, seeded prompt |
| Concurrent pull clicks | single in-flight pull per slug, both callers get its result |
| Mojito restart | stacks live in the shared tmux server, untouched (same isolation as lime sessions in the keeper) |

## Testing

- `tests/server/projectStack.test.ts` — fs/execFile mocked: listing includes every mapped
  project with the `hasStack` flag (executable start.sh) and status only when `hasStack`;
  slug sanitization; start/stop invocations; status mapping (none/live/dead pane);
  double-start guard.
- `ffPull` — execFile mocked: updated, up-to-date, diverged (both git messages), generic
  failure, in-flight dedup per slug (mirrors the self-update tests).
- `launchStackResolveSession` — resolves the mapped repo cwd, reads To-Merge
  model/effort, seeds the prompt (assert the template content and that no client string is
  interpolated), meta `kind: "custom"`; `buildCustomClaudeCommand` appends the prompt as the
  final quoted arg and omits it (unchanged output) when absent.
- Route tests per the existing pattern: 401 without token, 404 unknown slug, 409
  wrong-state transitions, response shapes — plus `/pull` (200 updated/up-to-date, 409
  diverged, 500 failed) and `/resolve` (201 meta shape).

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
  fb-start manually). Pull likewise targets only the branch checked out at that path.
- Stopping/restarting a single app within a stack.
- Auto-restarting a running stack after a pull (the user restarts it if the new code needs it).
- Unattended merge/rebase of a diverged history without the Claude resolve session.
- Log persistence/streaming beyond the live tmux view.
