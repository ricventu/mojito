# Post-refactor follow-ups (RIC-176)

Three deferred items from the final review of the Mojito-native lifecycle refactor
(`2026-08-07-mojito-native-lifecycle-design.md`). None blocked that work; together they
close the last gaps it left behind.

## Problem

**1. The QA verdict outcome is invisible.** `POST /api/tickets/[id]/verdict` already
returns `{ok, result}` with a discriminated `QaVerdictResult`, but `LaunchSheet` treats
every 2xx the same: `onLaunched(); onClose()`. Two of the four outcomes lose real
information.

- *Approve · MR* returns `{done: "mr-created", url}`. The URL is dropped on the floor.
  The user opened an MR and has no link to it.
- A rebase conflict returns `{done: "conflict-session"}`. The sheet closes exactly as it
  does after a clean merge, so a conflict is indistinguishable from success: the branch
  is **not** merged, the ticket stays at To QA, and a `mojito-<ticket>-conflict` session
  appears in the session list with nothing having said why.

**2. `postComment` is dead code.** `src/server/linear.ts:313` has no production call
site. Mojito never writes Linear comments — the rejection reason travels to the rework
session through its context file, not through the board. The function survives only
because `tests/server/linear.test.ts` still exercises it.

**3. `WORK_STATES` and `LAUNCHABLE_STATUSES` are the same list, maintained twice.**
`src/server/statusModel.ts` declares the authoritative work states; `src/lib/stageDefaults.ts`
re-declares them as the launchable statuses. Nothing pins them together, so adding a
work state silently leaves it without a stage default, falling through to `FALLBACK`
(`opus`/`high`) instead of the intended work profile — and `validateStageDefaults`
would reject the new status as unknown.

## Goals

1. After a verdict, the user learns anything the verdict produced that is not already
   visible on the board or in the session list.
2. `postComment` is gone, along with its test.
3. A work state added to `statusModel.ts` and not to `stageDefaults.ts` fails a test.

**Non-goals.** Any change to what the verdict *does* — the merge, the status writes,
and the session launches are untouched; this only reports them. A general toast or
notification layer: `AlertLayer` exists for session alerts and nothing else needs one.
Persisting outcomes across a page reload.

## Design

### Item 1 — surface the verdict outcome

**Which outcomes hold the sheet open.** Only the two that carry information the user
cannot get elsewhere.

| Outcome | Sheet | Why |
|---|---|---|
| `{done: "merged", commit}` | closes, as today | The ticket moves to Done; the board says so. |
| `{done: "rework-session"}` | closes, as today | The ticket moves to In Progress and the session appears in the list. |
| `{done: "mr-created", url}` | **stays open** | The URL exists nowhere else in the UI. |
| `{done: "conflict-session", sessionId}` | **stays open** | Silence here reads as success, and it is not. |

This keeps the common path — *Approve · merge* — at exactly the tap count it has today.

**Sheet states.** `LaunchSheet` gains one piece of state, `outcome: QaVerdictResult | null`.
`submitVerdict` parses the success body instead of discarding it, always calls
`onLaunched()` (the board and session list must refresh either way), and then either
closes or sets `outcome`. When `outcome` is set the sheet renders only its header and an
outcome panel — the verdict buttons, model/effort selectors, Assign and Docs are all
noise once the verdict is resolved.

The `result` field is validated before use: a body that is not one of the four known
shapes is treated as a plain success and closes the sheet, so a server/client version
skew degrades to today's behaviour rather than a blank panel.

**MR panel.** A short line plus the URL as an anchor (`target="_blank"`,
`rel="noreferrer"`), styled to wrap on a narrow screen rather than overflow the sheet.
A long-press on mobile copies it, so no separate copy button. The panel also states that
the ticket moved to Done, because the sheet header still shows the `To QA` chip it
opened with.

**Conflict panel.** States the three facts that matter: the rebase stopped on a
conflict, the branch was **not** merged, the ticket stays at To QA. Then an *Open
conflict session* button that jumps straight into the conflict session's terminal.

**Reaching the conflict session.** The button needs a `SessionMeta`, and the sheet
already receives the live `sessions` array. It looks the session up by id, exactly as
`page.tsx:66` does for `AlertLayer` — the established pattern for "open the session this
thing is about". The id comes from the server rather than being recomputed client-side:

- `QaVerdictDeps.launchConflictFix` returns `Promise<string>` (the tmux id) instead of
  `Promise<void>`.
- `QaVerdictResult`'s conflict arm becomes `{done: "conflict-session"; sessionId: string}`.
- The verdict route's `launchConflictFix` returns the `sid` it already computes.

The session is registered by `launchConflictSession` before the verdict response
returns, so the `onLaunched()` refetch brings it into `sessions` within one round trip.
Until it appears the button renders disabled and reads `Starting…`, which is honest
about the race instead of firing a lookup that silently no-ops.

`LaunchSheet` imports `QaVerdictResult` as a **type-only** import, so nothing from
`src/server/qaVerdict.ts` — or its `merge.ts` dependency — reaches the client bundle.

### Item 2 — delete `postComment`

Remove the function from `src/server/linear.ts` and its case from
`tests/server/linear.test.ts`. Nothing else references it.

### Item 3 — pin the two status lists together

Follow the precedent already set for this exact problem: `src/lib/status.ts` mirrors
`statusModel.ts` and `tests/lib/status.test.ts` pins them. A test, not an import —
`src/lib/stageDefaults.ts` is client code reached from `LaunchSheet`, and importing a
server module for three string literals would cross a boundary the codebase keeps
deliberately.

`tests/lib/stageDefaults.test.ts` gains a sync guard asserting `LAUNCHABLE_STATUSES`
equals `WORK_STATES` as an ordered list, plus a check that every launchable status has a
`BUILTIN_STAGE_DEFAULTS` entry — the drift that motivates the pin is a missing default,
so the test should say so directly rather than surfacing as a `TypeError` in the
unrelated seed-defaults case that already dereferences `BUILTIN_STAGE_DEFAULTS[s]`.
`STAGE_DEFAULT_ROWS` needs no new guard: it is already pinned to `LAUNCHABLE_STATUSES`
(`tests/lib/stageDefaults.test.ts:47`), so pinning that to `WORK_STATES` covers the rows
transitively. Both source files get a comment naming the other, matching the `status.ts`
/ `statusModel.ts` header comments.

### Minor extra

`src/app/api/sessions/route.ts:83` swallows a failed best-effort "In Progress" board
move without a word. It gains a `console.warn` matching the one the description fetch
already uses twenty lines above.

The review's other two extras are already done on `main`: the launch-time description
fetch logs a warning (`route.ts:62`) and `tests/server/sessionsRoute.test.ts` covers the
route with five cases.

## Testing

- `tests/server/qaVerdict.test.ts` — the conflict case returns the id its
  `launchConflictFix` produced.
- `tests/server/verdictRoute.test.ts` — a conflict response body carries
  `result.sessionId` equal to `mojito-<ticket>-conflict`.
- `tests/server/linear.test.ts` — `postComment`'s case removed; the rest untouched.
- `tests/lib/stageDefaults.test.ts` — the sync guard and the built-in-coverage check,
  both of which must fail if a work state is added to only one file.
- `tests/server/sessionsRoute.test.ts` — a failing board move still returns 201 and
  warns.

`LaunchSheet` has no test today and the project has no component-test harness; the
sheet's logic stays thin enough that the server-side assertions above carry the
contract. Verified by hand against the four outcomes.
