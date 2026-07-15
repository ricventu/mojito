# RIC-110 follow-up — Resolve the To QA verdict without opening a claude session

## Problem

RIC-110 stopped the **advance** route from launching a *second* claude session when the
user clicks `approve` / `reject` at the To QA gate. But the gate buttons live inside
`TerminalView`, and the only way to reach them is to launch a To QA session first:

1. Tap a To QA ticket → `LaunchSheet` → **Start session** → `POST /api/sessions` →
   `launchSession` spawns `claude … /lime-next <TICKET>` (Stage 4 gate).
2. Open that terminal → `TerminalView` shows approve / reject.
3. Click → `advance` route resolves the verdict server-side (no 2nd launch — the RIC-110
   fix).

So a claude session still opens (step 1) purely to reach buttons whose verdict Mojito
already resolves as a pure Linear mutation (`resolveQaVerdict` in `qaVerdict.ts`).
`launch.ts` always spawns claude regardless of status — there is no To-QA-specific path.

## Goal

For a ticket at status **To QA**, let the user approve / reject **directly in the
interface**, with no claude session ever spawned. The verdict stays a pure Linear
mutation:

- **approve** → set Linear status to **To Merge**. No comment.
- **reject** → require a typed reason → post it as a Linear comment → set status to
  **To Code**.

Everything else is unchanged. The **To Merge** gate (`local` / `mr`) still launches a lime
Stage 5 session — real merge work needs claude.

## Non-goals / not touched

- **No lime change.** lime's Stage 4 still exists for bare-terminal use. The Mojito→lime
  dependency stays one-directional.
- `resolveQaVerdict` / `qaVerdict.ts` — reused as-is, not modified.
- `STAGE_OF`, `GATE_STATES`, `decideAutoAdvance` in `autoAdvance.ts` — unchanged. To QA
  stays a `GATE_STATE` so auto-advance still stops at it.
- The `advance` route (`/api/sessions/[id]/advance`) — unchanged. Its To QA branch stays
  as a harmless safety net for any pre-existing To QA session.
- The To Merge gate path (`local` / `mr`) — unchanged.

## Design

### Server — testable orchestration + thin route

The `advance` route is keyed by session id and reads `prev.ticket` from the registry. A
To QA ticket now has **no session**, so we need a path keyed by ticket identifier.

The repo convention (CLAUDE.md) is: logic lives in `src/server/` and is unit-tested;
route handlers under `src/app/api/` are thin, untested glue (the `advance` route follows
this). So the new orchestration goes in a `src/server/` module, not the route.

**New `src/server/ticketVerdict.ts` — pure, unit-testable orchestration.**

```
export type VerdictResult =
  | { ok: true; arg: QaArg }
  | { ok: false; code: 400 | 409 | 422; error: string };

export interface TicketVerdictDeps {
  getIssueStatus: (ticket: string) => Promise<string>;
  resolveVerdict: (input: { ticket: string; arg: QaArg; reason?: string }) => Promise<void>;
  supersedeStaleSession: (ticket: string) => Promise<void>;
}

export async function resolveTicketVerdict(
  input: { ticket: string; arg: string; reason?: string },
  deps: TicketVerdictDeps,
): Promise<VerdictResult>
```

1. Validate `arg ∈ {"approve","reject"}` → else `{ ok:false, code:400 }`.
2. `status = await deps.getIssueStatus(ticket)`. If `status !== "To QA"` →
   `{ ok:false, code:409, error:"ticket is not at To QA" }` (guards a stale UI).
3. `await deps.resolveVerdict({ ticket, arg, reason })`.
   - `QaVerdictError` (empty reject reason) → `{ ok:false, code:400, error }`.
   - Any other throw (Linear / network / missing workflow state) →
     `{ ok:false, code:422, error }`. The stale-session cleanup is **not** run on error,
     so the user can retry.
4. `await deps.supersedeStaleSession(ticket)` — retires any pre-existing To QA session
   (belt-and-suspenders; a no-op when none exists).
5. `{ ok:true, arg }`.

Ticket-id validation (`validateTicket`) happens in the route before calling this, since it
throws rather than returns.

**New `src/app/api/tickets/[id]/verdict/route.ts`** — thin wiring, mirrors `advance`:

- Auth via `tokenFromHeaders`; parse `{ arg, reason }`; `validateTicket(id)` (invalid →
  `400`).
- Build `TicketVerdictDeps` from live services:
  - `getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t)`
  - `resolveVerdict: (i) => resolveQaVerdict(i, { setIssueStatus: (t,s)=>setIssueStatus(cfg.linearApiKey,t,s), postComment: (t,b)=>postComment(cfg.linearApiKey,t,b) })`
  - `supersedeStaleSession: async (t) => { const sid = tmuxName(t,"To QA"); if (getRegistry().get(sid)) await supersedeSession(sid, { closeSession, registry: getRegistry() }); }`
- Call `resolveTicketVerdict`, then map the result: `ok` → `200 { ok:true, arg }`;
  otherwise `NextResponse.json({ error }, { status: code })`.

No changes to `linear.ts` — `getIssueStatus`, `setIssueStatus`, `postComment` all already
exist (added in RIC-110). No changes to `qaVerdict.ts`.

### Client — extract `QaVerdictButtons`, wire it into `LaunchSheet`

**New `src/components/QaVerdictButtons.tsx`** — the approve / reject-with-inline-reason UI,
lifted verbatim from `TerminalView`'s current To QA branch. One source of truth.

```
export default function QaVerdictButtons(
  { onApprove, onReject }:
  { onApprove: () => void; onReject: (reason: string) => void },
)
```

- Owns its own `rejecting` / `reason` state (moved out of `TerminalView`).
- `approve` button → `onApprove()`.
- `reject` button → reveals inline `<textarea>` + `confirm reject` button; confirm →
  `onReject(reason)`, disabled while `reason.trim()` is empty.
- Renders only the buttons (the caller supplies the surrounding container / error display).

**`src/components/LaunchSheet.tsx`** — branch on `To QA` at the top of the sheet body:

- When `ticket.statusName === "To QA"`: render `<QaVerdictButtons>` instead of the
  model/effort/auto/Start form (and instead of the "open existing session" affordances).
  - `onApprove` → `submitVerdict("approve")`.
  - `onReject(reason)` → `submitVerdict("reject", reason)`.
  - `submitVerdict` → `POST /api/tickets/${ticket.identifier}/verdict` with `{ arg, reason? }`.
    - Success → `onLaunched()` (refreshes tickets + sessions) then `onClose()`.
    - Failure → set `err` to the response's `error` (or a status fallback), shown via the
      existing `err-text` display.
- All other statuses render the launch form exactly as today.

**`src/components/TerminalView.tsx`** — remove the now-dead To QA branch:

- Delete the `rejecting` / `reason` state and the `To QA` arm of the gate `<div>`.
- The gate block renders **only** for `To Merge` (the `local` / `mr` buttons). Replace the
  `isGate = GATE_STATES.includes(...)` gate condition with a To-Merge-specific check
  (e.g. `launchStatus === "To Merge"`), so a To QA session (should one exist) falls back to
  the normal `AccessoryBar` rather than rendering an empty/incorrect gate.
- `advance(arg, reason?)` stays (To Merge still uses `advance("local")` / `advance("mr")`),
  but the `reason` parameter is no longer exercised from here; keep the signature since the
  advance route still accepts it.

### Data flow

```
Tap To QA ticket → LaunchSheet detects statusName==="To QA"
  → QaVerdictButtons
    approve      → POST /api/tickets/RIC-110/verdict {arg:"approve"}
    reject+reason→ POST /api/tickets/RIC-110/verdict {arg:"reject", reason}
      → route: getIssueStatus guard → resolveQaVerdict → (supersede stale session)
      → 200 → onLaunched()+onClose()
```

No `POST /api/sessions`, no `launchSession`, no claude. ✓

## Error handling

- Invalid `arg` / invalid ticket id → `400`.
- Ticket not at To QA (stale UI) → `409`, surfaced in the sheet's `err-text`.
- Empty / whitespace reject reason → `400` (server-enforced; the confirm button is also
  disabled client-side).
- Missing workflow state (`To Merge` / `To Code` absent) or Linear/network failure → `422`
  with the message; surfaced in `err-text`; no session superseded so retry is safe.

## Testing

- **`tests/server/ticketVerdict.test.ts`** (new) — unit-tests `resolveTicketVerdict` with
  stubbed deps (spies for `getIssueStatus` / `resolveVerdict` / `supersedeStaleSession`),
  the same style as `qaVerdict.test.ts`:
  - To QA + `approve` → calls `resolveVerdict({arg:"approve"})` then
    `supersedeStaleSession`; returns `{ ok:true }`.
  - To QA + `reject` + reason → passes the reason through to `resolveVerdict`; returns
    `{ ok:true }`.
  - Status not To QA → `{ ok:false, code:409 }`; `resolveVerdict` / `supersedeStaleSession`
    **not** called.
  - Invalid `arg` → `{ ok:false, code:400 }`; `getIssueStatus` not called.
  - `resolveVerdict` throws `QaVerdictError` → `{ ok:false, code:400 }`;
    `supersedeStaleSession` **not** called.
  - `resolveVerdict` throws a generic error → `{ ok:false, code:422 }`.
- `qaVerdict.test.ts` — already covers approve/reject/empty-reason orchestration;
  unchanged. `linear.test.ts` — `setIssueStatus` / `postComment` already covered;
  unchanged. The route handler stays thin, untested glue (as the `advance` route is).
- Full gate: `npx tsc --noEmit && npx vitest run`.

## Rollout

Single Mojito change. No data migration, no Linear workflow-state changes (`To Merge` /
`To Code` already exist), no lime version bump.
