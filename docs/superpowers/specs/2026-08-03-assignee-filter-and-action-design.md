# Assignee filter and assign/unassign action — design

2026-08-03

## Problem

`listOpenIssues` (`src/server/linear.ts`) filters server-side with
`assignee: { isMe: { eq: true } }`, so the Tickets list can only ever show issues
assigned to the API key's owner. Open issues with no assignee are invisible in Mojito —
including the ones `/lime-new` creates without assigning anyone (at the time of writing:
RIC-169, RIC-168, RIC-167, RIC-158, RIC-139). There is no way to see them and no way to
take one, short of opening Linear.

## Requirements

- The "only my tickets" restriction becomes a **toggle in the UI**, on by default so the
  list looks unchanged on first load.
- With the toggle off the list shows **every open issue** (`state.type` not in
  `completed`/`canceled`), regardless of assignee.
- Each ticket gets an action to **assign it to the viewer** or **clear its assignee**.
- The toggle state persists across reloads, like the existing query/project/status
  filters.

## Design

### Server — all open issues, plus an `assignedToMe` flag

`listOpenIssues` drops the `assignee` clause from the GraphQL filter and keeps only
`state: { type: { nin: ["completed", "canceled"] } }`. The selection set gains
`assignee { isMe }`; `mapIssueNode` maps it to a new `TicketSummary` field:

```ts
assignedToMe: boolean   // false when the issue is unassigned or assigned to someone else
```

`first: 100` and the project/identifier sort are unchanged. The workspace currently has
roughly 40 open issues, so dropping the assignee filter stays well inside the page size.

Filtering client-side rather than re-querying keeps the toggle instant and costs no extra
Linear round-trip; the 45s poll in `useTickets` already refreshes the whole set.

### Client — the `Mine` toggle

`src/lib/ticketFilter.ts` gains one pure, testable function:

```ts
/** Tickets assigned to the viewer, or all of them when the filter is off. */
export function mineOnly(tickets: TicketSummary[], mine: boolean): TicketSummary[]
```

`filterTickets` and `TicketFilter` are untouched — the assignee restriction is a
*scope* applied before the other criteria, not a fourth criterion alongside them.

`TicketList` applies `mineOnly` first and derives `projects` and `statuses` from the
scoped result. That ordering matters: deriving the chips from the unscoped list would
offer projects and statuses that belong to other people's tickets and yield "No matching
tickets" when picked.

The toggle is stored with `usePersistedState("mojito-tickets-mine", "1")`, read as
`mineRaw !== "0"` so the default (absent key) is on.

`FilterBar` takes two optional props, `mine: boolean` and `onMine: (v: boolean) => void`,
and renders a `chip toggle` labelled `Mine` as the **first** chip of the status row,
followed by a separating margin. First, not last: `.filter-chips` is
`overflow-x: auto` (globals.css:118) and the status row holds 7–8 chips, so a trailing
chip would sit off-screen on a phone. The status row renders when it has status chips
**or** the toggle.

### Assign / unassign

`src/server/linear.ts`:

```ts
export async function setIssueAssignee(
  apiKey: string,
  identifier: string,
  toMe: boolean,
  fetchImpl?: typeof fetch,
): Promise<void>
```

Resolves the issue through the existing `getIssueRef`, resolves the viewer with
`query { viewer { id } }` when `toMe` is true (otherwise the assignee id is `null`), then
runs `issueUpdate(id, input: { assigneeId })`. The viewer lookup is skipped entirely when
unassigning.

Route `src/app/api/tickets/[id]/assignee/route.ts`, modelled on the sibling
`verdict/route.ts`: `POST`, token check via `tokenFromHeaders`, `validateTicket(id)`,
body `{ mine: boolean }`. Non-boolean `mine` → 400; a Linear failure → 502; success →
`{ ok: true }`.

`LaunchSheet` renders a `btn ghost block` between "Custom session" and "Docs", labelled
`Unassign` when the ticket is assigned to the viewer and `Assign to me` otherwise. It
holds the assigned state locally, seeded from `ticket.assignedToMe`, and updates it
optimistically so the sheet **stays open** — assigning a ticket and then starting its
session is one flow, not two. `onLaunched()` refreshes the list underneath. Failures
reset the optimistic state and surface in the existing `err-text` paragraph.

Consequence, accepted deliberately: with `Mine` on, unassigning a ticket removes it from
the list as soon as the sheet closes.

## Testing

- `tests/lib/ticketFilter.test.ts` — `mineOnly` with the filter on and off; the existing
  `filterTickets` cases stay valid.
- `tests/server/linear.test.ts` — `listOpenIssues` no longer sends an assignee filter and
  maps `assignedToMe` from `assignee.isMe`; `setIssueAssignee` sends the viewer lookup and
  an `issueUpdate` carrying the viewer id, and sends `null` without a viewer lookup when
  unassigning.
- New `tests/server/assigneeRoute.test.ts` — 401 without a token, 400 on a non-boolean
  `mine`, 200 on success (following `reviewScaleRoute.test.ts` for the route-test shape).
- `TicketSummary` fixtures in `tests/lib/orderTickets.test.ts` and
  `tests/lib/ticketFilter.test.ts` need the new field.

Full gate: `npx tsc --noEmit && npx vitest run`.

## Out of scope

- Assigning to anyone other than the viewer. Mojito is single-operator; a user picker
  would need a user list endpoint and a search UI for no current benefit.
- Filtering by a specific other assignee. The toggle is binary: mine, or everything.
- Showing who a ticket is assigned to. Only the boolean is fetched; adding a name to the
  card is a separate change if the workspace ever gains a second person.
