# RIC-110 — Handle the To QA verdict inside Mojito

## Problem

At the **To QA** approval gate, clicking `approve` / `reject` in Mojito currently POSTs to
`/api/sessions/[id]/advance`, which **launches a new claude/lime session** running
`/lime-next <TICKET> approve|reject`. That session does Stage 4 in Linear (approve → To
Merge; reject → comment + To Code).

Spawning a whole claude session just to flip a status and post a comment is wasteful. The
verdict is a pure Linear mutation — Mojito can do it directly.

## Goal

For a session at status **To QA**, resolve the verdict inside Mojito without launching a
claude session:

- **approve** → set Linear status to **To Merge**. No comment.
- **reject** → require a typed reason → post it as a Linear comment → set status to **To
  Code**.

Everything else is unchanged. In particular the **To Merge** gate (`local` / `mr`) still
launches a lime Stage 5 session — real merge work (rebase, conflict handling, MR creation)
genuinely needs claude.

## Non-goals / not touched

- **No lime change.** lime's Stage 4 still exists and still runs in bare-terminal mode.
  Mojito simply stops *delegating* the To QA verdict to it. The Mojito→lime dependency
  stays one-directional.
- `STAGE_OF` and the status model in `autoAdvance.ts` are unchanged.
- The `To Merge` gate path (`local` / `mr`) is unchanged.
- Auto-advance behavior is unchanged: `To Merge` is itself a `GATE_STATE`, so an approve
  that lands the ticket there stops at the next gate exactly as before.

## Design

### Server

**1. `src/server/linear.ts` — add two mutations.** Today the module only reads
(`listOpenIssues`, `getIssueStatus`). Add:

- A lookup that returns the issue's GraphQL node `id` and `team { id }` alongside its
  status — mutations need the node id, not the `RIC-110` identifier. Either extend the
  existing `getIssueStatus` query or add a small `getIssueRef(apiKey, identifier)` helper
  returning `{ id, teamId, statusName }`. Prefer a dedicated helper so `getIssueStatus`
  keeps its narrow shape.
- `setIssueStatus(apiKey, identifier, targetStateName, fetchImpl?)`:
  1. Resolve the issue ref (node id + team id).
  2. Query the team's workflow states (`team(id) { states { nodes { id name } } }`) and
     resolve `targetStateName` → state id (exact name match).
  3. If the target name does not resolve, throw a clear error
     (`workflow state "<name>" not found in team`) — mirrors lime's "create the state
     first" guard so a missing state fails loudly instead of silently.
  4. `issueUpdate(id: <nodeId>, input: { stateId: <stateId> })`.
- `postComment(apiKey, identifier, body, fetchImpl?)`:
  1. Resolve the issue node id.
  2. `commentCreate(input: { issueId: <nodeId>, body })`.

All helpers follow the existing `query<T>()` pattern (raw GraphQL, `fetchImpl` injectable
for tests).

**2. New `src/server/qaVerdict.ts` — pure, unit-testable orchestration.**

```
export type QaArg = "approve" | "reject";
interface QaVerdictDeps {
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  postComment: (ticket: string, body: string) => Promise<void>;
}
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg; reason?: string },
  deps: QaVerdictDeps,
): Promise<void>
```

- `approve` → `deps.setIssueStatus(ticket, "To Merge")`.
- `reject`:
  - Trim `reason`. If empty → throw a `QaVerdictError` the route maps to **400** (the UI
    should prevent this, but the server enforces it).
  - `deps.postComment(ticket, "QA rejected — " + reason)`.
  - `deps.setIssueStatus(ticket, "To Code")`.
  - Order matters: comment first, then status change, so a rejection is never silently
    statused-back without its reason recorded.

**3. `src/server/app.ts` / route wiring.** The `advance` route currently only reads
`getIssueStatus`. It gains access to `setIssueStatus` / `postComment` (via `linear.ts`,
using `cfg.linearApiKey`).

**4. `src/app/api/sessions/[id]/advance/route.ts` — branch on the resolved status.**

- Parse `{ arg, reason }` from the body (`reason` optional).
- After resolving `status = getIssueStatus(...)`:
  - **If `status === "To QA"` and `arg ∈ {approve, reject}`:** call `resolveQaVerdict`,
    then `supersedeSession(id, …)` to retire the gate session, and return `200` with a
    small JSON `{ ok: true, arg }`. Do **not** launch a session.
  - **Otherwise** (To Merge `local`/`mr`, or any other status): the existing
    `launchSession` + supersede path, unchanged.
- `VALID_ARGS` still gates the arg. A `QaVerdictError` (empty reason) → `400`; a Linear
  error (e.g. missing target state) → `422` with the message.

### Client

**`src/components/TerminalView.tsx`** — the To QA gate gets an inline reason field.

- `approve` button → `advance("approve")` immediately (unchanged call, no reason).
- `reject` button → reveals an inline `<textarea>` (reason) + a confirm button. Confirm →
  `advance("reject", reason)` only when the reason is non-empty; the confirm button is
  disabled while the reason is blank.
- `advance(arg, reason?)` includes `reason` in the POST body when present.
- Success → `onBack()` (unchanged). Errors → existing `advErr` display.
- The `To Merge` gate (`local` / `mr`) renders exactly as today — the inline reason UI is
  scoped to `launchStatus === "To QA"`.

## Error handling

- Empty reject reason → `400` (server-enforced; UI also disables confirm).
- Missing workflow state (`To Merge` / `To Code` absent in the team) → `setIssueStatus`
  throws → route returns `422` with the message; surfaced in `advErr`.
- Linear API / network failure → `422` with the error message; the gate session is **not**
  superseded (the user can retry).

## Testing

- `qaVerdict.test.ts` — approve calls `setIssueStatus("…","To Merge")`; reject-with-reason
  posts the comment then sets `To Code` (assert order); reject with empty/whitespace reason
  throws `QaVerdictError` and calls neither dep.
- `linear.test.ts` — `setIssueStatus` builds the state-resolution query and the
  `issueUpdate` mutation from a fake `fetch`; throws on an unresolved target state;
  `postComment` builds `commentCreate`.
- Route-level (if the existing suite covers the advance route): the To QA branch resolves
  the verdict and does not launch; the To Merge branch still launches.

## Rollout

Single Mojito change, no data migration, no Linear workflow-state changes (the states
`To Merge` / `To Code` already exist). No lime version bump.
