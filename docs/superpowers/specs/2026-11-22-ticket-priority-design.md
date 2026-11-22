# Ticket priority: show, sort, filter, edit (RIC-610)

## Why

The human picks the next ticket to launch from the desktop board and triages from the phone.
Priority must be readable at a glance on every card, and quick to change in the ticket sheet.

## Goals

- Read Linear's priority for every board ticket.
- Sort by it, always: within each status (kanban column, phone list status group) and in Backlog,
  Urgent → High → Medium → Low → No priority, then by ticket number as today.
- Show it on the card as a small Linear-style icon; nothing for No priority.
- Change it from the ticket sheet: a priority pill beside the status pill, opening the five
  values (No priority, Urgent, High, Medium, Low), written to Linear.
- Filter the board by it: a multi-select Priority group in the filter sheet, in the url and in
  favourites.

## Non-goals

- No sort switch (Number / Priority): one order, no control.
- No editing from the card (a small target beside the id link and the card's own tap).
- No priority in the New-ticket sheet; the create-ticket agent keeps leaving it unset.

## Approaches

- Sorting — **A, always on** (picked) vs B, a Number/Priority switch in the filter sheet, in the url
  and favourites. A: Linear's own default, and number order carries no meaning worth a control on a
  phone-first UI.
- Editing — **A, ticket sheet pill** (picked) vs B, also by tapping the card's icon. B mis-taps on
  a phone next to the id link and the card tap.

## Design

- **Shared:** `TicketSummary.priority?: number` — Linear's value, 0 none, 1 urgent … 4 low.
  Optional: an older peer's tickets have none, read as 0. A `PriorityBody` (`priority` int 0-4).
  Names and order (`PRIORITIES`) live in shared so server and web agree.
- **Server:** `listOpenIssues` asks for `priority` and keeps it only if it is an integer 0-4 (else 0).
  `setPriority(identifier, priority)` → `issueUpdate(input: { priority })`.
  `POST /api/tickets/:id/priority` mirrors `/status`: 400 bad id/body, 502 on Linear failure, then
  `tickets.refresh()`.
- **Board order** (`lib/board.ts`): `byStatusThenIdentifier` becomes status → priority rank →
  identifier; Backlog priority rank → identifier. Rank: 1,2,3,4 then 0 last. Kanban columns and
  the phone list both read `active`, so both follow.
- **Card** (`TicketCard`): the icon before the id, `aria-label` "Priority: High"; hidden for 0. Icons:
  Urgent a filled square with `!` (lucide `SquareAlert` or similar), High/Medium/Low three bars
  with 3/2/1 filled (lucide `SignalHigh`/`SignalMedium`/`SignalLow`, or a small inline mark).
  Neutral colour, never emerald/sky/amber/red (session state colours) — Urgent may use the
  foreground colour, like Linear.
- **Sheet** (`TicketSheet`): a `PriorityPill` (a `Select`, like `StatusPill`) beside the status, with
  each value's icon; optimistic, rolled back with an error toast on refusal, success toast
  `RIC-610 → High`, then `qk.tickets` invalidated.
- **Filter** (`lib/filters.ts`): `BoardFilters.priorities: string[]`, url values `urgent`, `high`,
  `medium`, `low`, `none`, repeated `priority=`; canonical order Urgent → No priority (like
  `FILTER_STATUSES`), unknown values dropped. Counts in `filterCount`/`isFiltered`. `filterBoard`:
  a ticket matches if its priority is among them; like a label filter it opens Backlog and hides
  loose sessions (they have no priority). `favoriteName` includes it. Filter sheet: a Priority
  group with the five values, after Status.

## Left to the builder

Exact icon components and where the card icon sits relative to the id; placement of the group in
the filter sheet; test shape (pure logic in `lib` and the server client/route, as for labels).
