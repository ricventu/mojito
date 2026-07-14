# Session ordering (RIC-108)

## Goal

Order the session list by ticket and chronologically. Today sessions render grouped by
project, but within each project group they appear in arbitrary registry insertion order.
This makes it hard to find related sessions or read them in time order.

## Requirements

- Keep the existing **project** grouping and its headers unchanged.
- Within each project group:
  - **Cluster by ticket** — all sessions sharing the same `ticket` identifier are adjacent.
  - **Newest first** everywhere:
    - sessions inside a ticket cluster are sorted by `createdAt` descending (newest session first);
    - ticket clusters are ordered by each cluster's most-recent `createdAt`, descending.
  - **Adjacency only** — no new visible ticket sub-header/divider. Session cards already
    display the ticket title, so clustering is expressed purely through order.
- Deterministic and stable: equal `createdAt` values tie-break on session `id` (string
  compare), descending, so renders don't reorder unpredictably.

## Non-goals

- No backend change: `Registry.all()` and the `/api/sessions` route stay order-agnostic.
- No new timestamp field on `SessionMeta`; `createdAt` (ISO string) is the only sort key.
- Project grouping logic is unchanged.
- No changes to `TicketList` or other consumers.

## Design

Ordering is a presentation concern, so it lives on the client in
`src/components/SessionList.tsx`, at the grouping step (~lines 21–30). Other consumers
(e.g. `TicketList`) may want different orders, and the registry stays order-agnostic.

Extract the ordering as a **pure helper** so it can be unit-tested:

```ts
// orders a project group's sessions: cluster by ticket, newest-first within and across
export function orderSessions(items: SessionMeta[]): SessionMeta[]
```

Algorithm:

1. Group `items` by `ticket`.
2. Within each ticket cluster, sort by `createdAt` descending; tie-break by `id`
   descending.
3. Compute each cluster's key = max `createdAt` in the cluster (its newest session).
4. Order clusters by that key descending; tie-break by the cluster's ticket id descending
   for determinism.
5. Concatenate clusters in that order and return the flat list.

`SessionList.tsx` calls `orderSessions(...)` on each project group's items before the
existing `items.map(...)` render. No JSX/markup change.

### Data shape (reference)

`SessionMeta` (`src/server/types.ts`): relevant fields are `id`, `ticket`
(e.g. `"RIC-46"`), `createdAt` (ISO string). Only `createdAt` exists — no
`updatedAt`/`startedAt`.

## Testing

Unit test the pure helper (vitest, existing `tests/` setup):

- Multi-ticket group clusters same-ticket sessions adjacently.
- Within a cluster, sessions are newest-first by `createdAt`.
- Clusters are ordered by their newest session, newest-first.
- Equal `createdAt` → deterministic tie-break by `id`.
- Empty and single-session inputs are returned unchanged.

## Touch points

- `src/components/SessionList.tsx` — call `orderSessions` in the grouping step.
- New helper (co-located or a small util module) exporting `orderSessions`.
- New test file under `tests/` for `orderSessions`.
