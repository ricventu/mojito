# RIC-110 follow-up — Choose gate actions in Mojito before launching (no post-launch gate)

## Problem

RIC-110 stopped the **advance** route from launching a *second* claude session when the
user clicks a gate action. But the gate buttons live inside `TerminalView`, and the only
way to reach them is to launch a session first. Both lifecycle gates suffer from this:

- **To QA** — approve / reject is a pure Linear mutation (`resolveQaVerdict` in
  `qaVerdict.ts`), yet the user must first launch a claude Stage-4 session just to see the
  buttons. Claude is spawned for nothing.
- **To Merge** — `local` / `mr` picks the Stage-5 merge mode. Today the user launches a
  gate session *with no arg*, opens it, then clicks `local`/`mr`, which **relaunches** a
  second session with the arg as `trailingArg`. The mode should be chosen *before* the one
  and only launch.

Root cause for both: the gate choice happens *after* a session exists, inside
`TerminalView`. `launch.ts` always spawns `claude … /lime-next <TICKET>` regardless of
status, and `POST /api/sessions` ignores `trailingArg` entirely (only the `advance` route
forwards it).

## Goal

Move both gate choices *before* the launch, into `LaunchSheet` (the sheet opened by tapping
a ticket):

- **To QA** → resolve the verdict directly, **no claude session**:
  - **approve** → set Linear status to **To Merge**. No comment.
  - **reject** → require a typed reason → post it as a Linear comment → set status to
    **To Code**.
- **To Merge** → pick `local` / `mr` in the sheet, then launch **one** claude Stage-5
  session with that arg as `trailingArg`.

`TerminalView` no longer has any gate UI — it always shows the terminal + `AccessoryBar`.
The `/api/sessions/[id]/advance` route is removed (it was only ever called by the
`TerminalView` gate).

## Non-goals / not touched

- **No lime change.** lime's Stage 4 / Stage 5 still exist for bare-terminal use. The
  Mojito→lime dependency stays one-directional.
- `resolveQaVerdict` / `qaVerdict.ts` — reused as-is, not modified.
- `STAGE_OF`, `GATE_STATES`, `decideAutoAdvance` in `autoAdvance.ts` — unchanged. To QA and
  To Merge stay `GATE_STATES` so auto-advance still **stops** at them (a human then acts in
  the sheet). This is why auto-advance never needs `trailingArg`.
- `launch.ts` / `LaunchRequest` — already carries `trailingArg`; unchanged.

## Design

### Server

**1. `POST /api/sessions` — forward `trailingArg`.** The route currently drops it. Add:

- Read `body.trailingArg`. If present, validate it against `{"local","mr"}` → else `400`
  `{ error: "invalid trailingArg" }`. (`launchSession`/`buildClaudeCommand` already
  shell-quote it, but a whitelist keeps the surface tight and the intent explicit — mirrors
  the old advance route's `VALID_ARGS`.)
- Pass `trailingArg` through to `launchSession` in the `LaunchRequest`.

**2. New `src/server/ticketVerdict.ts` — pure, unit-testable orchestration** (To QA only).

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
     `{ ok:false, code:422, error }`. Stale-session cleanup is **not** run on error, so the
     user can retry.
4. `await deps.supersedeStaleSession(ticket)` — retires any pre-existing To QA session
   (belt-and-suspenders; no-op when none exists).
5. `{ ok:true, arg }`.

**3. New `src/app/api/tickets/[id]/verdict/route.ts`** — thin wiring:

- Auth via `tokenFromHeaders`; parse `{ arg, reason }`; `validateTicket(id)` (invalid →
  `400`).
- Build `TicketVerdictDeps` from live services:
  - `getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t)`
  - `resolveVerdict: (i) => resolveQaVerdict(i, { setIssueStatus: (t,s)=>setIssueStatus(cfg.linearApiKey,t,s), postComment: (t,b)=>postComment(cfg.linearApiKey,t,b) })`
  - `supersedeStaleSession: async (t) => { const sid = tmuxName(t,"To QA"); if (getRegistry().get(sid)) await supersedeSession(sid, { closeSession, registry: getRegistry() }); }`
- Call `resolveTicketVerdict`; `ok` → `200 { ok:true, arg }`, else
  `NextResponse.json({ error }, { status: code })`.

**4. Delete `src/app/api/sessions/[id]/advance/route.ts`** and its directory. No other
caller (verified: only `TerminalView` used it). `resolveQaVerdict`, `setIssueStatus`,
`postComment`, `supersedeSession` all stay (used elsewhere / by the new route).

No changes to `linear.ts` or `qaVerdict.ts`.

### Client

**1. New `src/components/QaVerdictButtons.tsx`** — the approve / reject-with-inline-reason
UI, lifted verbatim from `TerminalView`'s current To QA branch. One source of truth.

```
export default function QaVerdictButtons(
  { onApprove, onReject }:
  { onApprove: () => void; onReject: (reason: string) => void },
)
```

- Owns its own `rejecting` / `reason` state.
- `approve` → `onApprove()`. `reject` → reveals inline `<textarea>` + `confirm reject`
  (disabled while `reason.trim()` is empty) → `onReject(reason)`.
- Renders only the buttons; the caller supplies the container / error display.

**2. `src/components/LaunchSheet.tsx`** — branch on `ticket.statusName`:

- **`"To QA"`** → render `<QaVerdictButtons>` (no model/effort/auto form, no
  open-existing-session affordances):
  - `onApprove` → `submitVerdict("approve")`; `onReject(reason)` → `submitVerdict("reject", reason)`.
  - `submitVerdict` → `POST /api/tickets/${ticket.identifier}/verdict` `{ arg, reason? }`.
    Success → `onLaunched()` then `onClose()`. Failure → set `err` from the response's
    `error`, shown via the existing `err-text` display.
- **`"To Merge"`** → the model / effort / auto form, but the single `Start` button is
  replaced by **two** buttons: `Start · local` and `Start · mr`. Each calls
  `start(mode)` which sends `trailingArg: mode` in the `POST /api/sessions` body (all other
  launch fields unchanged, including the existing "clear a finished same-name session
  first" step).
- **Any other status** → the launch form exactly as today (single `Start`, no
  `trailingArg`).

`start` is generalized to accept an optional `trailingArg` and include it in the POST body
when present.

**3. `src/components/TerminalView.tsx`** — remove all gate UI:

- Delete the `isGate` / `GATE_STATES` import usage, the `rejecting` / `reason` / `advErr`
  state, the `advance()` function, and the entire gate `<div>`.
- The component now always renders the terminal + `<AccessoryBar>`.

### Data flow

```
Tap To QA ticket → LaunchSheet (statusName==="To QA") → QaVerdictButtons
  approve/reject → POST /api/tickets/<id>/verdict
    → resolveTicketVerdict: getIssueStatus guard → resolveQaVerdict → supersede stale
    → 200 → onLaunched()+onClose()
  (no /api/sessions, no claude)

Tap To Merge ticket → LaunchSheet (statusName==="To Merge") → [Start·local]/[Start·mr]
  → POST /api/sessions { …, trailingArg:"local"|"mr" }
    → launchSession → claude … /lime-next <TICKET> local|mr   (one session, arg upfront)
```

## Error handling

- **Verdict route:** invalid `arg` / invalid ticket id → `400`; ticket not at To QA (stale
  UI) → `409`; empty reject reason → `400` (also disabled client-side); Linear/network /
  missing workflow state → `422`. All surfaced in the sheet's `err-text`; no session
  superseded on error → retry is safe.
- **Sessions route (To Merge):** invalid `trailingArg` → `400`; `duplicate` → `409`;
  `no-repo` → `422` (unchanged). Surfaced in the sheet.

## Testing

- **`tests/server/ticketVerdict.test.ts`** (new) — unit-tests `resolveTicketVerdict` with
  stubbed deps (spies for `getIssueStatus` / `resolveVerdict` / `supersedeStaleSession`),
  same style as `qaVerdict.test.ts`:
  - To QA + `approve` → `resolveVerdict({arg:"approve"})` then `supersedeStaleSession`;
    `{ ok:true }`.
  - To QA + `reject` + reason → reason passed through; `{ ok:true }`.
  - Status not To QA → `{ ok:false, code:409 }`; `resolveVerdict` / `supersedeStaleSession`
    **not** called.
  - Invalid `arg` → `{ ok:false, code:400 }`; `getIssueStatus` not called.
  - `resolveVerdict` throws `QaVerdictError` → `{ ok:false, code:400 }`;
    `supersedeStaleSession` **not** called.
  - `resolveVerdict` throws generic error → `{ ok:false, code:422 }`.
- **`tests/server/launch.test.ts`** — already asserts `buildClaudeCommand` appends
  `trailingArg` (`… /lime-next RIC-1 approve`). Add a case asserting `local` / `mr` append
  the same way (guards the To Merge command shape).
- `qaVerdict.test.ts`, `linear.test.ts` — unchanged. Route handlers and `LaunchSheet` /
  `TerminalView` are thin glue / UI, untested (as the deleted advance route was).
- Full gate: `npx tsc --noEmit && npx vitest run`.

## Rollout

Single Mojito change. No data migration, no Linear workflow-state changes (`To Merge` /
`To Code` already exist), no lime version bump.
