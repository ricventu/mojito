# Active-session indicator on ticket cards (RIC-116)

## Problem

The ticket list (`TicketList`) shows every Linear ticket as a card but gives no
signal about whether a lime session is currently running for that ticket. To see
active work the user must switch to the Sessions tab and cross-reference by ticket
id. The ticket says: *"Nella lista dei ticket mostrare se ci sono sessioni
attive"* — in the ticket list, show whether there are active sessions.

## Goal

On each ticket card, show a compact indicator when that ticket has at least one
**active** session, colored by the most urgent active state. No indicator when the
ticket has no active session.

## Definitions

- **Active session**: a session whose `state` is `starting`, `running`, or
  `needs-input`. This matches the `existingActive` predicate already used in
  `LaunchSheet.tsx` and the `active` predicate in `SessionList.tsx`.
- **Not active**: `done` and `failed` sessions. They contribute nothing to the
  indicator (per product decision — the ticket wording is "sessioni attive").
- **Urgency order**: `needs-input` > `running`/`starting`. `needs-input` is the
  actionable, human-blocking state already highlighted elsewhere (the `.card.attn`
  amber treatment and the Sessions-tab count badge), so it wins.

## Design

A pure, unit-tested helper plus a presentational dot — mirroring the existing
`src/lib/orderSessions.ts` + `tests/lib/orderSessions.test.ts` pattern. Session
state already lives client-side and updates live (see Data flow), so no server-side
or API change is warranted.

### 1. Helper — `src/lib/ticketSessionLevel.ts`

```ts
import type { SessionMeta } from "@/server/types";

export type ActiveLevel = "attn" | "run";

/**
 * The active-session level for a ticket, or null when it has none.
 * "attn" (needs input) outranks "run" (running/starting). done/failed ignored.
 */
export function activeSessionLevel(
  ticket: string,
  sessions: SessionMeta[],
): ActiveLevel | null;
```

Behavior:

- Consider only sessions where `s.ticket === ticket`.
- If any such session has `state === "needs-input"` → return `"attn"`.
- Else if any has `state === "running"` or `state === "starting"` → return `"run"`.
- Else (only `done`/`failed`, or no matching sessions) → return `null`.

Pure function, no mutation, no dependence on session order.

### 2. Component — `src/components/TicketList.tsx`

- Build a `Map<string, ActiveLevel>` once per render with `useMemo`, keyed by
  ticket identifier, computed via `activeSessionLevel` over the tickets that have a
  non-null level. Depends on `[tickets, sessions]`.
  - Rationale: one pass instead of scanning `sessions` inside every card's render.
- In each ticket card's header row (the line with `.id` and `.status`), render the
  dot when the ticket has a level:

  ```tsx
  {level && (
    <span
      className={`s-dot ${level}`}
      aria-label={level === "attn" ? "needs input" : "session running"}
      title={level === "attn" ? "needs input" : "session running"}
    />
  )}
  ```

- No dot element is rendered when `level` is `null` (no empty span).

### 3. Styling — `src/app/globals.css`

Add a standalone `.s-dot`:

- ~8px circle (`width`/`height`, `border-radius: 50%`), `display: inline-block`,
  vertically aligned with the id/status text, small left margin.
- `.s-dot.run` uses `var(--run)`; `.s-dot.attn` uses `var(--attn)` — the same
  tokens the existing `.badge` dots use, so the colors match.
- `.s-dot.attn` may carry a subtle glow (e.g. `box-shadow` in the attn color) to
  draw the eye; optional and cosmetic.

### 4. Accessibility

The dot is not color-only: it carries `aria-label` and `title` so its meaning is
available to screen readers and on hover. This satisfies WCAG 1.4.1 (use of color).

## Data flow (no change needed)

`page.tsx` already passes the live `sessions` array into `TicketList`, and
`useEvents` calls `refreshSessions()` on every WebSocket event. So as a session
transitions (e.g. `running` → `needs-input` → `done`), `sessions` updates and the
dot re-renders in real time. The indicator is a pure projection of props already
present; no fetching, polling, or state is added.

## Testing — `tests/lib/ticketSessionLevel.test.ts`

Unit tests for `activeSessionLevel`:

- No sessions → `null`.
- Only `done`/`failed` sessions for the ticket → `null`.
- One `running` session → `"run"`; one `starting` session → `"run"`.
- One `needs-input` session → `"attn"`.
- Mixed `running` + `needs-input` → `"attn"` (priority).
- `needs-input` for a *different* ticket, `running` for this ticket → `"run"`
  (matching is per-ticket).
- Sessions for unrelated tickets only → `null`.

Test helper builds minimal `SessionMeta` objects (id/ticket/state and required
fields). Full suite gate: `npx tsc --noEmit && npx vitest run`.

## Out of scope

- No change to `SessionMeta`/`TicketSummary` types or any API route.
- No change to the Sessions tab, `SessionList`, or the lime launch-context contract.
- No count/multi-badge display — a single dot per ticket (product decision).
- No indicator for `done`/`failed` sessions.
