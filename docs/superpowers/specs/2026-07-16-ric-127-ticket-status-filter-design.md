# RIC-127 — Ticket status filter

## Summary

Add a **status filter** to the Tickets tab, presented as a chip row directly below the
existing project chip row. It behaves like the project filter (single-select toggle,
derived from the tickets currently loaded, persisted across reloads), but each chip is
colored with its lifecycle hue so the row reads consistently with the status badges used
elsewhere in the app.

Ticket text: *"Add a ticket-status filter like the project filter, in the row below the
project filter."*

## Current state

- `src/components/FilterBar.tsx` renders a search input row (`.filter-top`) plus **one**
  chip row (`.filter-chips`) of plain toggle chips for **projects** (`All` + one per
  project). The chip row renders only when `projects.length > 1 || active !== null`.
- `src/components/TicketList.tsx` owns the filter state:
  - `query` — persisted at `mojito-tickets-q`
  - `project` — persisted at `mojito-tickets-project` (empty string is the "no filter"
    sentinel, mapped to `null`)
  - derives `projects` = distinct project names present in `tickets`, sorted
  - `filtered` = tickets kept when they match the active project **and** the query
    (query matches identifier / title / statusName / labels), computed inline
  - groups `filtered` by project, then by status via `groupByStatus`
- `src/lib/status.ts` provides `statusRank(name)` (lifecycle order; unknown last) and
  `statusColorClass(name)` (hue class: `grey`/`blue`/`indigo`/`amber`/`teal`/`green`/
  `red`/`muted`).
- `src/app/globals.css` defines the hue color variables (`--run`, `--indigo`, `--attn`,
  `--teal`, `--ok`, `--err`, `--wait`) and the `.badge.<hue>` rules that use them; chips
  are styled by `.chip` / `.chip.on`.
- `usePersistedState(key, initial)` mirrors a string value into `localStorage`.

## Requirements

1. A second chip row appears directly **below** the project chip row in the Tickets tab.
2. Chips: `All` + one chip per lifecycle status **present in the currently loaded
   tickets**, ordered by `statusRank` (matching the status grouping order in the list).
   No chip is shown for a status that no loaded ticket has.
3. **Single-select**, mirroring the project filter: either `All` (no status filter) or
   exactly one status is active.
4. Each status chip is tinted with its lifecycle hue via `statusColorClass`: outlined /
   tinted when inactive, filled when active. The `All` chip stays a neutral toggle,
   identical to the project `All` chip.
5. Filtering is **AND**: a ticket is shown only if it matches the active project *and* the
   active status *and* the search query. Existing project/query behavior is unchanged.
6. The active status is **persisted** to `localStorage` key `mojito-tickets-status` via
   `usePersistedState`, using the same empty-string → `null` sentinel mapping as the
   project filter, so it survives reloads.
7. Row visibility mirrors the project row: the status row is shown when
   `statuses.length > 1 || activeStatus !== null`. When a chosen status stops being
   present in the tickets (e.g. after a refresh), the existing "No matching tickets."
   empty state applies.

## Design

Chosen approach: **extend `FilterBar` with optional status props** (Approach A).

Rejected alternatives:
- Generalize `FilterBar` into an array of N chip-groups — more flexible but YAGNI for two
  filters; adds indirection and touches every existing call site.
- A separate `StatusChips` component composed in `TicketList` — splits the single bordered
  `.filter` block into two visual pieces.

### 1. `src/lib/ticketFilter.ts` (new — pure, tested)

Lift the currently-inline filter logic into a pure module, following the existing
`orderTickets` / `groupByStatus` pattern (pure function in `src/lib/`, unit-tested in
`tests/lib/`).

- `ticketStatuses(tickets: TicketSummary[]): string[]` — distinct `statusName` values
  present, ordered by `statusRank` (unknown statuses last, alphabetical tie-break, same
  rule `groupByStatus` uses).
- `filterTickets(tickets, { query, project, status }): TicketSummary[]` — returns the
  tickets that match all active criteria:
  - `project` (`string | null`): when non-null, `(t.project ?? NO_PROJECT) === project`.
  - `status` (`string | null`): when non-null, `t.statusName === status`.
  - `query` (`string`): trimmed + lowercased; when non-empty, matches any of
    `identifier`, `title`, `statusName`, `labels` (unchanged from today).

  `NO_PROJECT` becomes owned by this lib module (its single source of truth). Today it is
  exported from `FilterBar.tsx` and imported by **both** `TicketList` and `SessionList`; a
  lib module must not depend on a component, so the constant relocates down to lib and
  `FilterBar` **re-exports** it (`export { NO_PROJECT } from "@/lib/ticketFilter"`). Both
  existing consumers keep importing it from `FilterBar` unchanged — no call-site churn,
  correct dependency direction, same string value.

### 2. `src/components/FilterBar.tsx`

Add three **optional** props so existing callers stay valid:

- `statuses?: string[]`
- `activeStatus?: string | null`
- `onStatus?: (s: string | null) => void`

When `statuses` (and `onStatus`) are provided, render a second `.filter-chips` row below
the project row, using the same visibility rule
(`statuses.length > 1 || activeStatus != null`). Each status chip gets its hue class from
`statusColorClass(status)`; the `All` chip is a plain toggle like the project `All`. The
active chip carries the `on` state.

### 3. `src/components/TicketList.tsx`

- Add `const [statusRaw, setStatusRaw] = usePersistedState("mojito-tickets-status", "")`,
  mapped to `status` (`""` → `null`) and `setStatus` exactly like `project`.
- Derive `const statuses = useMemo(() => ticketStatuses(tickets), [tickets])`.
- Replace the inline `filtered` computation with
  `filterTickets(tickets, { query, project, status })`.
- Pass `statuses`, `status`, `setStatus` into `<FilterBar>`.

Grouping (project → status) is unchanged; the status filter only narrows the input set.

### 4. `src/app/globals.css`

Add status-chip hue rules scoped to `.filter-chips`, reusing the existing hue variables:

- Inactive status chip: text + border tinted with its hue (mirroring `.badge.<hue>`
  border via `color-mix`), transparent-ish background.
- Active status chip (`.chip.on.<hue>`): filled with the hue's `*-bg` background.

The `All` chip has no hue class, so it keeps the current `.chip` / `.chip.on` styling.

## Testing

- `tests/lib/ticketFilter.test.ts` (new):
  - `ticketStatuses`: present-only, ordered by lifecycle rank, unknown-status last,
    de-duplication.
  - `filterTickets`: project-only, status-only, query-only, all three combined, and the
    no-filter case; confirms AND semantics and that query still matches
    identifier/title/statusName/labels.
- `npx tsc --noEmit && npx vitest run` stays green (176 existing tests unaffected —
  extracting the predicate preserves the project+query behavior).

## Out of scope (YAGNI)

- Multi-select statuses.
- A status filter on the Sessions tab.
- Filtering by anything other than lifecycle status (labels, assignee, etc.).
