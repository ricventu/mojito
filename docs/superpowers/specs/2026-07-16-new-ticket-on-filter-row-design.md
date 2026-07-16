# Move "New ticket" onto the filter row — Design

**Ticket:** RIC-132 — «Spostare "New ticket" sulla riga del filtro di ricerca, a destra»
**Date:** 2026-07-16

## Goal

Move the `+ New ticket` action out of its own dedicated row and onto the ticket
**search-filter row**, right-aligned, so the Tickets tab no longer spends a full
row on a single button.

## Background

In `src/components/TicketList.tsx` the button currently lives on a standalone
row above the filter:

```jsx
<div className="row" style={{ marginBottom: 12 }}>
  <span className="grow" />
  <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
</div>
{tickets.length > 0 && (
  <FilterBar … placeholder="Filter tickets…" />
)}
```

`FilterBar` (`src/components/FilterBar.tsx`) **already exposes an `action` slot**:
it renders `{action}` immediately after the search `<input>` inside `.filter-top`.
The relevant CSS (`src/app/globals.css`) already right-aligns anything placed
there — `.filter-top` is `display:flex; align-items:center; gap:8px`, with
`.filter-top .search { flex:1; min-width:0 }` and `.filter-top .btn { flex:none }`.
The search input grows to fill the row and any action button is pushed to the right.

The **Sessions tab already uses this exact pattern** — `SessionList.tsx:67` passes
its "New session"/"Clean up" buttons via `action`, and its empty state
(`SessionList.tsx:75-79`) shows a full-width block button. This change makes the
Tickets tab consistent with it.

This is a **UI-only change in one component** (`TicketList.tsx`). No CSS, server,
API, or data change.

## Design

All changes are in `src/components/TicketList.tsx`.

### 1. Remove the dedicated button row

Delete the standalone `<div className="row">…</div>` block (currently lines
51–54) that holds the `grow` spacer and the button.

### 2. Pass the button through FilterBar's `action` slot

On the existing `FilterBar` usage, add the `action` prop, keeping the current
primary style:

```jsx
<FilterBar
  query={query} onQuery={setQuery}
  projects={projects} active={project} onProject={setProject}
  statuses={statuses} activeStatus={status} onStatus={setStatus}
  placeholder="Filter tickets…"
  action={
    <button className="btn primary sm" onClick={() => setNewOpen(true)}>+ New ticket</button>
  }
/>
```

The button now sits on the search row, right of the input, right-aligned by the
existing flexbox rules — no CSS change.

### 3. Preserve "New ticket" when there are zero tickets

`FilterBar` only renders when `tickets.length > 0`. Because the button moves
*inside* `FilterBar`, it would disappear when the list is empty — you could no
longer create the first ticket. Mirror the Sessions tab's empty state: when
`tickets.length === 0`, render a block button.

```jsx
{tickets.length === 0 && (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <p className="empty">No tickets.</p>
    <button className="btn primary block" onClick={() => setNewOpen(true)}>+ New ticket</button>
  </div>
)}
```

This matches `SessionList.tsx:75-79` (which uses `btn primary block`), so the two
tabs behave identically when empty.

### Behavior matrix after the change

| State                          | What shows                                                        |
|--------------------------------|-------------------------------------------------------------------|
| `tickets.length === 0`         | "No tickets." + block `+ New ticket` button (empty state)         |
| Tickets exist                  | FilterBar row: search input + right-aligned `+ New ticket` action |
| Tickets exist, filtered to 0   | FilterBar row (button still reachable) + "No matching tickets."    |

`setNewOpen` / `NewTicketSheet` wiring is unchanged; both the action button and
the empty-state button call `setNewOpen(true)`.

## Data flow

Unchanged. This only moves where the existing `+ New ticket` button is rendered.

## Error handling

None required — purely presentational; no code path can fail.

## Testing

- No React component test harness exists in the repo — vitest runs
  `environment: "node"` over `tests/**/*.test.ts` only (no jsdom/RTL). Adding one
  for a JSX layout move is out of scope (YAGNI), consistent with prior UI specs.
- Keep `npx tsc --noEmit` and `npx vitest run` green (the existing server/lib
  suite does not touch `TicketList`, but must stay passing).
- Verification is visual, in the running app's Tickets tab:
  1. With tickets present: `+ New ticket` sits on the same row as the search
     input, right-aligned; the previous dedicated row is gone; clicking it still
     opens the New ticket sheet.
  2. With no tickets: "No tickets." and a full-width `+ New ticket` button show,
     and it opens the sheet.

## Out of scope

- Any CSS, server, API, or data change.
- Restyling the button to `ghost` (kept `primary`, per decision).
- Changes to the Sessions tab or to `FilterBar` itself (its `action` slot already
  exists and is reused as-is).
- Adding a React component test harness.
