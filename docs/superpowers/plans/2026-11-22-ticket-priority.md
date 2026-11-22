# Ticket Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, sort, filter and edit Linear's ticket priority on the board (RIC-610).

**Architecture:** The server reads `priority` with the open issues and writes it through a
`/priority` route mirroring `/status`. The web sorts by it inside each status, draws an icon on the
card, a pill in the ticket sheet, and a Priority group in the filter sheet carried by the url codec.

**Tech Stack:** Hono, Linear GraphQL, React 19, TanStack Query, shadcn Select, lucide, vitest (node).

**Spec:** `docs/superpowers/specs/2026-11-22-ticket-priority-design.md`

## Global Constraints

- Priority values are Linear's: 0 No priority, 1 Urgent, 2 High, 3 Medium, 4 Low.
- `TicketSummary.priority` is optional; absent (older peer) reads as 0.
- Sort: status → priority rank (1, 2, 3, 4, then 0) → identifier; Backlog: rank → identifier.
- url: repeated `priority=` with `urgent|high|medium|low|none`, canonical order Urgent → No priority,
  written after `status=` and before `label=`.
- Icons neutral: never emerald/sky/amber/red (session state colours). Copy English.

## Review Focus

- Linear sends `priority` as a non-integer or out of range (or null): stored as 0, never a crash.
- A ticket from an older peer with no `priority`: sorts as No priority, no card icon, matches `none`.
- A priority filter with matches only in Backlog: Backlog opens; loose sessions hidden.
- A favourite saved before this change (no `priority`): still parses and matches; `priority=bogus` dropped.
- Linear refuses the priority write: the sheet's pill returns to the old value with an error toast.

---

### Task 1: Shared types and server read/write

**Files:** Modify `packages/shared/src/types.ts`, `packages/shared/src/api.ts` (or a new
`packages/shared/src/priority.ts` exported from the index), `apps/server/src/linear/client.ts`,
`apps/server/src/http/routes/tickets.ts`; tests `apps/server/test/linear/client.test.ts`,
`apps/server/test/http/tickets.test.ts`.

**Interfaces:**
- Produces (shared): `TicketSummary.priority?: number`;
  `PRIORITIES: readonly { value: 0|1|2|3|4; key: "none"|"urgent"|"high"|"medium"|"low"; name: string }[]`
  in sort order Urgent, High, Medium, Low, No priority (names exactly `Urgent`, `High`, `Medium`,
  `Low`, `No priority`); `PriorityBody = z.object({ priority: z.number().int().min(0).max(4) })`.
- Produces (server): `LinearClient.setPriority(identifier: string, priority: number): Promise<void>`;
  `POST /api/tickets/:id/priority` → `{ ok: true }`, 400 bad id/body, 502 Linear failure.

- [ ] Tests: `listOpenIssues` query text contains `priority`; a node with `priority: 2` → `priority: 2`;
  `priority: 7`, `1.5`, `null`, missing → `0`. `setPriority("RIC-1", 1)` sends `issueUpdate` with
  variables `{ id, priority: 1 }` (after the existing `issueRef` lookup). Route: 200 calls
  `setPriority("RIC-1", 3)` and `tickets.refresh`; `{priority: 5}` and `{priority: "high"}` → 400;
  bad id → 400; Linear throws → 502 `{error}`.
- [ ] Run `pnpm --filter server test` → new tests fail.
- [ ] Implement; `pnpm --filter server test && pnpm typecheck` → pass.
- [ ] Commit `feat(server): read and write ticket priority (RIC-610)`.

### Task 2: Board order, url codec, board filter, favourite name

**Files:** Modify `apps/web/src/lib/board.ts`, `lib/filters.ts`, `lib/favorites.ts`; create
`apps/web/src/lib/priority.ts`; tests `apps/web/test/lib/board.test.ts`, `filters.test.ts`,
`favorites.test.ts`, new `priority.test.ts`.

**Interfaces:**
- Consumes: `PRIORITIES`, `TicketSummary.priority` (Task 1).
- Produces: `lib/priority.ts`: `ticketPriority(t: TicketSummary): number` (valid 0-4 else 0),
  `priorityRank(p: number): number` (1→0 … 4→3, 0→4), `priorityKey(p: number)`;
  `BoardFilters.priorities: string[]` (keys, after `statuses`), `NO_FILTERS.priorities = []`,
  `FILTER_PRIORITIES` = keys in canonical order.

- [ ] Tests: `groupBoard` active order within one status: Urgent, High, Low, No priority, missing
  field, ties by number (RIC-9 before RIC-10); status still first; Backlog by rank then number.
  `parseFilters("priority=none&priority=urgent&priority=bogus")` → `["urgent","none"]`;
  `filterSearch` order `status=…&priority=…&label=…`; `isFiltered`/`filterCount` count priorities.
  `filterBoard` with `["high"]` keeps only High tickets, hides loose, opens Backlog, drops an emptied
  section; `["none"]` matches a ticket with no `priority` field. `favoriteName` →
  `Mojito · Todo · Urgent · Bug`; three priorities → `3 priorities`; `none` → `No priority`.
- [ ] Run `pnpm --filter web test` → new tests fail.
- [ ] Implement; `pnpm --filter web test && pnpm typecheck` → pass.
- [ ] Commit `feat(web): sort and filter the board by priority (RIC-610)`.

### Task 3: Card icon, sheet pill, filter sheet group, docs

**Files:** Create `apps/web/src/components/PriorityIcon.tsx`; modify
`components/board/TicketCard.tsx`, `components/sheets/TicketSheet.tsx`,
`components/board/FilterSheet.tsx`, `CLAUDE.md`.

**Interfaces:**
- Consumes: `PRIORITIES`, `ticketPriority`, `priorityKey`, `FILTER_PRIORITIES` (Tasks 1-2).
- Produces: `<PriorityIcon priority={n} size={12} />` (null for 0 only when the caller asks:
  the card skips 0; the sheet's list shows a dashed mark for No priority).

- [ ] `PriorityIcon`: Urgent lucide `SquareAlert` (foreground), High/Medium/Low `SignalHigh`/
  `SignalMedium`/`SignalLow` (`text-muted-foreground`), No priority a dashed mark (`Minus` or
  `Ellipsis`, muted). `aria-hidden`, the caller labels.
- [ ] `TicketCard`: icon before the id link, wrapped with `aria-label="Priority: High"` /
  `title`; nothing for 0.
- [ ] `TicketSheet`: `PriorityPill` (`Select`, styled like `StatusPill`, neutral) beside the status
  pill, five items with icons in `PRIORITIES` order; `useSetPriority` mirrors `useMoveTicket`:
  optimistic local value, rollback + `toast.error` on failure, `toast.success("RIC-610 → High")`,
  invalidate `qk.tickets`. Editable whenever the ticket is on this instance's board (no team needed).
- [ ] `FilterSheet`: a "Priority" fieldset after Status, `FilterChip` per `FILTER_PRIORITIES` with
  icon + name; update the sr-only description.
- [ ] `CLAUDE.md`: board filters list gains priority; Board bullet mentions priority order, card
  icon and sheet pill; server Linear/tickets mention `/priority`.
- [ ] `pnpm typecheck && pnpm test`, check in the browser (card icon, pill change round-trip,
  filter chip, phone width), commit `feat(web): show and edit ticket priority (RIC-610)`.
