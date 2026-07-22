# Self-update button (pull & deploy) — design

2026-07-22

## Problem

Mojito runs self-hosted on a cloud server (`/home/mojito/code/mojito`, systemd user
services, deploy-on-merge via a `post-merge` git hook). Merges made *on the server* by
lime deploy automatically. Merges made elsewhere and pushed to GitHub require an SSH
round-trip (`git pull` on the server) to activate. The user wants a button in the
Mojito settings sheet that does that pull from the UI.

## Requirements

- One button in `SettingsSheet` that updates **Mojito's own checkout only** (no
  generic per-project pull).
- Gated by `MOJITO_SELF_UPDATE=1` in the server's `.env.local`. Without the flag the
  button is absent (`GET` reports `enabled: false`) and the mutation endpoint
  returns 404 — the Mac dev instance never exposes it (a pull in the dev checkout
  risks the known Next-dev wedge and has no deploy hook).
- Fast-forward only (`git pull --ff-only`). A diverged history is reported as an
  error to resolve manually — never an unattended merge, never a reset.
- The deploy itself stays owned by the existing `post-merge` hook →
  `mojito-deploy.service` (stop → `npm ci` → build → start). This feature adds no
  second deploy pathway. The flag implies the hook is installed; a flag set without
  the hook means "pull succeeds but nothing redeploys" and is explicitly out of
  scope.
- After a successful update the UI shows a "deploying…" banner, polls
  `/api/health`, and reloads the page when the server comes back.

## Design

### Server module — `src/server/selfUpdate.ts`

- `isSelfUpdateEnabled(): boolean` — `process.env.MOJITO_SELF_UPDATE === "1"`.
- `runSelfUpdate(): Promise<SelfUpdateResult>` — in `process.cwd()`:
  1. `git rev-parse --short HEAD` (before)
  2. `git pull --ff-only` (execFile, 60s timeout, never a shell)
  3. `git rev-parse --short HEAD` (after)
  - Returns `{ status: "updated", from, to }` when HEAD moved,
    `{ status: "up-to-date", from, to }` when it didn't.
  - Throws `SelfUpdateError` with `kind: "diverged" | "failed"` and a trimmed
    stderr snippet. `diverged` is detected from the `--ff-only` failure output
    ("Not possible to fast-forward" / "fatal: Need to specify how to reconcile");
    anything else (network down, dirty tree, not a repo) is `failed`.
- Concurrency: a module-level in-flight promise; a second POST while one runs gets
  the same result (no parallel pulls).

### API route — `src/app/api/self-update/route.ts`

Same conventions as `/api/config/review-scale`: `getConfig()` +
`tokenFromHeaders` auth (401 without token).

- `GET` → `{ enabled: boolean }`. Always 200 (auth'd); the sheet uses it to decide
  whether to render the button.
- `POST` → 404 if the flag is off. Otherwise runs `runSelfUpdate()`:
  - 200 `{ status: "updated" | "up-to-date", from, to }`
  - 409 `{ error: "diverged", detail }` — history diverged, resolve from a terminal
  - 500 `{ error: "failed", detail }` — any other git failure

The POST response returns before the deploy finishes: the hook starts
`mojito-deploy.service` asynchronously (`--no-block`), so the pull outcome is
always deliverable even though the process will be stopped moments later.

### UI — `SettingsSheet.tsx`

- On open, fetch `GET /api/self-update`; when `enabled`, render a "Server" section
  under the existing controls with a **Pull & deploy** button.
- Click → button disabled, "Pulling…" → POST:
  - `up-to-date` → inline "Already up to date (<from>)".
  - error → inline error text (existing `err-text` style), detail truncated.
  - `updated` → inline "Updated <from> → <to>", banner "Deploying — the server
    restarts in ~1 min…", then health polling.
- Health poll (every 3s, `apiFetch` to `/api/health`): wait for at least one
  failure (server went down) *then* the first success → `location.reload()`.
  Fallback: after 5 min without recovery, replace the banner with "Deploy still
  running — reload manually" and stop polling. Rationale for the down-then-up
  dance: the deploy is async, so the server may still answer 200 for a few
  seconds after the POST returns.

## Error handling summary

| Case | Surface |
| --- | --- |
| Token missing/wrong | 401 (existing pattern) |
| Flag off | button absent; POST → 404 |
| Diverged history | 409, UI: "history diverged — resolve from a terminal" |
| Network/other git failure | 500 with stderr snippet |
| Deploy never comes back | 5-min poll timeout, manual-reload message |
| Concurrent clicks | single in-flight pull, both callers get its result |

## Testing

- `tests/server/selfUpdate.test.ts` — execFile mocked: updated, up-to-date,
  diverged (both git messages), generic failure, flag off, in-flight dedup.
- Route tests following the existing `tests/server` route patterns: 401 without
  token, 404 with flag off, response shape on success/divergence.
- UI poll logic: extract the down-then-up predicate into a small pure helper so it
  is unit-testable without timers.

## Out of scope (noted for later)

- Server push access to GitHub (deploy key). Without it, server-side lime merges
  can't reach origin, which is the main source of future divergence. Worth doing
  separately if divergence errors become frequent.
- Generic per-project pull buttons.
- Streaming deploy logs into the UI.

## Addendum (RIC-164 / RIC-165 coordination): extract `ffPull(cwd)`

RIC-165 (project stacks) adds a per-project Pull that uses the exact same
fast-forward logic. To avoid duplicating it, the fast-forward core moves into its own
module and `selfUpdate.ts` becomes a thin caller. This is the only change from the
design above; behaviour is otherwise identical.

### New module — `src/server/ffPull.ts`

- `ffPull(cwd: string): Promise<FfPullResult>` — runs, all in `cwd`:
  1. `git rev-parse --short HEAD` (before)
  2. `git pull --ff-only` (execFile, 60s timeout, never a shell)
  3. `git rev-parse --short HEAD` (after)
  - Returns `{ status: "updated", from, to }` when HEAD moved,
    `{ status: "up-to-date", from, to }` when it didn't.
  - Throws `FfPullError` with `kind: "diverged" | "failed"` and a trimmed stderr
    snippet. `diverged` is detected from the `--ff-only` failure output
    ("Not possible to fast-forward" / "fatal: Need to specify how to reconcile");
    anything else (network down, dirty tree, not a repo) is `failed`.
- **Stateless — no single-flight inside.** Concurrency control is the caller's job,
  because the two callers scope it differently: self-update is one global checkout
  (module-level in-flight promise), while RIC-165 pulls many project checkouts
  (a per-slug in-flight map keyed by cwd). Baking one policy into `ffPull` would be
  wrong for the other.

### Refactor — `src/server/selfUpdate.ts`

- `isSelfUpdateEnabled()` unchanged (`process.env.MOJITO_SELF_UPDATE === "1"`).
- `runSelfUpdate()` keeps the module-level in-flight promise and now delegates the
  git work to `ffPull(process.cwd())`. The route mapping (diverged → 409,
  failed → 500) still keys off the error `kind`, so `selfUpdate` surfaces
  `ffPull`'s error kind unchanged (re-throw, or re-expose `SelfUpdateError` carrying
  the same `kind`). `SelfUpdateResult` shape is unchanged.

### Testing delta

- New `tests/server/ffPull.test.ts` — execFile mocked, exercises the core:
  updated, up-to-date, diverged (both git messages), generic failure. `cwd` is
  passed through to execFile.
- `tests/server/selfUpdate.test.ts` keeps flag-off gating and the in-flight-dedup
  test (a second call while one runs gets the same result); the git-outcome cases
  are covered by `ffPull.test.ts`, so `selfUpdate`'s tests focus on the wrapper
  (gate + dedup + error passthrough).
