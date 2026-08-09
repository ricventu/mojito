# Push from the Stacks panel (RIC-169) — design

2026-08-09

## Problem

The QA-approve merge (`src/server/merge.ts`, `mode: "local"`) rebases the ticket branch and
fast-forwards the repo root's default branch — **locally**. Nothing ever pushes. A day of
tickets approved from the phone leaves the mapped checkout many commits ahead of `origin`
(Mojito's own `main` was 46 commits ahead when this ticket was written), and the only fix
today is an ssh session.

The Stacks panel already owns the "keep this checkout in sync" affordance (Pull, from
RIC-165). It gains the other half: **Push**.

## Scope

- A **Push** button on every Stacks row, including the Mojito self-row.
- A **Pull & deploy** button on the Mojito self-row, wired to the *existing guarded*
  self-update endpoint — not to the raw stacks pull.

Out of scope: pushing anything other than the branch checked out at the mapped repo path;
force-pushing; creating an upstream for a branch that has none beyond what plain
`git push origin <branch>` does; auto-pull-then-retry; ahead/behind counters in the row.

## What Push pushes

The branch **checked out at the mapped repo path** — the same path and the same
"whatever is checked out there" rule Pull follows. After a QA merge that branch *is* the
default branch, which is what the ticket asks for; no extra "must be main" rule is
imposed, so a repo root parked on another branch stays usable rather than showing a dead
button.

Never `--force`, never `--force-with-lease`. A push that cannot fast-forward is surfaced,
not resolved (same principle as `ffPull`'s refusal to merge).

## Server — `src/server/gitPush.ts` (new)

A standalone helper mirroring `ffPull.ts`, stateless (single-flight is the caller's job):

```ts
export interface GitPushResult {
  status: "pushed" | "up-to-date";
  branch: string;
  from: string; // short SHA of origin/<branch> before, "" when the remote branch is new
  to: string;   // short SHA of origin/<branch> after
}
export class GitPushError extends Error {
  constructor(public readonly kind: "detached" | "rejected" | "failed",
              public readonly detail: string) { /* … */ }
}
export async function gitPush(cwd: string, run?: GitRun): Promise<GitPushResult>
```

Steps:

1. `git rev-parse --abbrev-ref HEAD` → branch. Empty or `HEAD` → `GitPushError("detached",
   "repo is on a detached HEAD")`, before anything is pushed.
2. `git rev-parse --short origin/<branch>` → `from`. Failure means the remote branch does
   not exist yet; `from` is `""` and this is not an error.
3. `git push origin <branch>` — `execFile`, no shell, `LC_ALL=C`, 60s timeout,
   `maxBuffer` 64MB (same reasoning as `ffPull`: an ENOBUFS must not misreport a push that
   actually landed).
4. `git rev-parse --short origin/<branch>` → `to`. `git push` updates the remote-tracking
   ref itself, so `from === to` means "up-to-date" and a change means "pushed". A new
   remote branch (`from === ""`) is always "pushed".

Failure classification, by git's own output (stdout+stderr, English pinned by `LC_ALL=C`):

| Output contains | kind | Why |
| --- | --- | --- |
| `[remote rejected]` | `failed` | A server-side hook refused (protected branch). Pulling would not help, so it must not say "Pull first". Checked **before** the marker below, since this text also contains "rejected". |
| `[rejected]` or `Updates were rejected` | `rejected` | Non-fast-forward: `origin` has commits the checkout does not. |
| anything else | `failed` | Network, auth, no `origin`, not a repo. |

`detail` is a trimmed output snippet (500 chars), as in `ffPull`/`merge`.

## Server — `src/server/projectStack.ts`

- `pushStack(slug, deps): Promise<StackPushResult>` — resolves the target through the
  existing `resolveStack`, then runs `gitPush` behind a **per-slug single-flight map**
  (`pushInflight`), exactly like `pullStack`'s. Two concurrent POSTs for one slug share the
  one push and its result. `_resetStackInflight()` clears both maps.
- Result shape mirrors `StackPullResult`:
  `{ ok: true; result: GitPushResult } | { ok: false; error: string; code: number; detail?: string }`,
  with `rejected` → 409, `detached`/`failed` → 500, unknown slug → 404.
- **Pushability is not gated.** Every mapped project — the Mojito self-row included — can
  push: a push mutates no working tree and fires no local hook, so the `pullable` reasoning
  (below) does not apply. `StackDeps` gains an optional `push?: (cwd) => Promise<GitPushResult>`
  seam for tests, matching `pull?`.
- `StackTarget` and `StackRow` gain `self: boolean` — the server-side path comparison that
  already computes `pullable`, exposed explicitly instead of leaving the client to infer
  "self" from `!pullable`.

## API — `POST /api/stacks/[slug]/push`

Same shape as the sibling routes (`getConfig()` + `tokenFromHeaders` → 401):

- 200 `{ status, branch, from, to }`
- 409 `{ error: "rejected", detail }`
- 500 `{ error: "detached" | "failed", detail }`
- 404 unknown slug

`GET /api/stacks` rows now carry `self`. No other route changes: **`/api/stacks/[slug]/pull`
keeps returning 404 for the Mojito self-row** (`pullable: false`), unchanged from RIC-165.

## Client

### `src/lib/stacks.ts`

- `StackRow` gains `self: boolean`.
- `PushResponse = { status: "pushed" | "up-to-date"; branch: string; from: string; to: string }
  | { error: string; detail?: string }`.
- `pushMessage(res): { kind: "ok" | "err"; text: string }` — a sibling of `pullMessage`,
  pure and unit-tested:
  - pushed, known `from`: `Pushed <branch> <from> → <to>.`
  - pushed, new remote branch: `Pushed <branch> (new remote branch).`
  - up-to-date: `Nothing to push (<branch> at <to>).`
  - `rejected`: `origin has commits you don't have — Pull first.` (detail appended when
    present; the 409 body carries `{error, detail}` only, so the message does not name the
    branch). The advice is actionable because the Pull button sits next to it and already
    offers "Resolve with Claude" on a diverged history.
  - `detached`: `Repo is on a detached HEAD — nothing to push.`
  - other: `Push failed — <detail>`.

`pushMessage` returns no `canResolve`: the push path never launches a Claude session. The
existing `pullMessage` shape is left alone.

### `src/lib/selfUpdate.ts` + `src/lib/useSelfUpdate.ts` (new)

The "Pull & deploy" behavior currently inline in `SettingsSheet.tsx` — the
`MOJITO_SELF_UPDATE` capability probe, the `idle | pulling | deploying | timeout` phase
machine, `POST /api/self-update`, and the `/api/health` poll that must see the server go
down and come back (`deployPoll.ts`) before `location.reload()` — moves verbatim into a
hook:

```ts
useSelfUpdate(token): { enabled, phase, message, error, run }
```

Behavior is unchanged, including the unmount cleanup that cancels the pending tick and the
5-minute timeout. The response→text mapping the sheet does inline becomes a pure
`selfUpdateMessage(res)` in `src/lib/selfUpdate.ts` (the testable seam, since hooks are not
rendered in this suite). `SettingsSheet` renders from the hook; the Stacks self-row uses
the same hook, so both call sites share one implementation instead of duplicating a deploy
poller.

### `src/components/StacksPanel.tsx`

- Every row gets a **Push** button (after Pull), disabled while the row is busy, its result
  rendered through the existing `msg` slot via `pushMessage`.
- The **self-row** additionally gets a **Pull & deploy** button — `useSelfUpdate().run()` —
  rendered only when `enabled` (i.e. `MOJITO_SELF_UPDATE=1`: present on the server, absent
  on the Mac dev instance). It shows the same phase feedback as Settings ("Pulling…",
  "Deploying — the server restarts in ~1 min…", the timeout hint).
- Non-self rows are otherwise untouched.

### Why the self-row Pull is not the raw stacks pull

Mojito's checkout has a `post-merge` hook that starts `mojito-deploy.service`. A raw
`git pull` there would trigger an unguarded deploy — bypassing the `MOJITO_SELF_UPDATE`
gate and the deploy-aware UX — and on a Mac dev checkout it would fire a hook whose unit
does not exist while a `next dev` server holds the tree. Routing the button to
`/api/self-update` gives the user the Pull they asked for on that row *and* keeps
RIC-165's guarantee that the stacks pull never touches Mojito's own checkout.

## Error handling

| Case | Surface |
| --- | --- |
| No token | 401 (existing pattern) |
| Unknown slug | 404 |
| `origin` ahead (non-fast-forward) | 409 `rejected`; message points at Pull |
| Protected branch / server hook refusal | 500 `failed` with git's message (never "Pull first") |
| Detached HEAD at the repo path | 500 `detached`, nothing pushed |
| No `origin`, auth failure, network | 500 `failed` + stderr snippet |
| Concurrent Push clicks | single in-flight push per slug; both callers get its result |
| Push while the stack runs | allowed; the stack is untouched |
| Mojito self-row Push | allowed (no working-tree change, no hook) |
| Mojito self-row Pull | guarded `/api/self-update`; hidden when `MOJITO_SELF_UPDATE` is off |

## Testing

- `tests/server/gitPush.test.ts` (new), `GitRun` mocked: `pushed` (SHA moved), `up-to-date`
  (SHA unchanged), new remote branch (`from` lookup fails → `from: ""`, status `pushed`),
  `rejected` classification, `[remote rejected]` classified `failed` and not `rejected`,
  generic failure, detached HEAD refusing before any push, and that the push command is
  exactly `push origin <branch>` with no force flag.
- `tests/server/projectStack.test.ts` (extended): `pushStack` returns the result for a
  mapped slug, 404 for an unknown one, maps each `GitPushError` kind to its status code,
  shares one in-flight push between two concurrent calls, and pushes the Mojito self-row
  (unlike pull). Row shape assertions gain `self`.
- `tests/server/stacksRoute.test.ts` (extended): `/push` 401 without token, 404, 200 body,
  409 `rejected`, 500 `failed`.
- `tests/lib/stacks.test.ts` (extended): every `pushMessage` branch.
- `useSelfUpdate`: vitest runs in the `node` environment over `tests/**/*.test.ts` with no
  React Testing Library, so hooks and components are never rendered in this suite — the
  codebase's convention is to test the pure helper a hook wraps (`deployPoll.ts`,
  `readPersisted`, `pullMessage`). The extraction follows it: the response→message mapping
  moves into a pure `selfUpdateMessage(res)` in `src/lib/selfUpdate.ts`, unit-tested for
  every branch (updated / up-to-date / diverged / failed / network error); the effectful
  hook is left to the existing `deployPoll` tests plus typecheck.
