# Label Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Labels section in the board's Filters sheet (RIC-609).

**Architecture:** Web only. `BoardFilters` gains `labels`, carried by the url codec, applied by
`filterBoard`, named by `favoriteName`; the sheet offers the labels of the loaded tickets.

**Tech Stack:** React 19, TanStack Query, vitest (node).

**Spec:** `docs/superpowers/specs/2026-11-21-label-filter-design.md`

## Global Constraints

- url parameter `label`, repeated; labels deduped and plain-`sort()`ed in the canonical form.
- Selected labels match **any** (OR), by exact name.
- Display order `localeCompare(b, "en")`; colours only through `labelColor`.

## Review Focus

- A selected label no ticket carries any more: still offered in the sheet, so it can be turned off.
- A label filter with a match only in Backlog: Backlog opens.
- A label filter and loose sessions: they are hidden (no labels).
- A favourite saved before this change (no `label`): still parses, still matches.
- Labels with `&`, `=`, `+`, spaces: round-trip through the url.

---

### Task 1: Codec, board filter, favourite name

**Files:** Modify `apps/web/src/lib/filters.ts`, `lib/board.ts`, `lib/favorites.ts`, `lib/labels.ts`;
tests `apps/web/test/lib/filters.test.ts`, `board.test.ts`, `favorites.test.ts`, `labels.test.ts`.

**Interfaces:**
- Produces: `BoardFilters.labels: string[]` (after `statuses`); `NO_FILTERS.labels = []`;
  `sheetLabels(tickets: TicketSummary[], selected: string[]): { name: string; color: string | null }[]` in `lib/labels.ts`.

- [ ] Tests: `parseFilters("label=Bug&label=Aa&label=Bug")` → `labels: ["Aa", "Bug"]`;
  `filterSearch` writes `label=` after `status=`, before `live`; `isFiltered`/`filterCount` count labels;
  `filterBoard` with `labels: ["Bug"]` keeps tickets carrying Bug (OR across two labels), hides loose,
  opens Backlog, drops a section left empty; `favoriteName` → `Mojito · Todo · Bug · Active`, three
  labels → `3 labels`; `sheetLabels` unions, keeps a selected absent label (color null), sorts by "en".
- [ ] Run `pnpm --filter web test` → the new tests fail.
- [ ] Implement; run tests and `pnpm typecheck` → pass.
- [ ] Commit.

### Task 2: Labels section in the Filters sheet

**Files:** Modify `apps/web/src/components/board/FilterSheet.tsx`.

- [ ] A "Labels" fieldset after Status: `FilterChip`s from `sheetLabels(useTickets().data?.tickets ?? [], filters.labels)`,
  each with a colour dot when `color` is set; "No labels." when the list is empty. Update the sr-only description.
- [ ] `pnpm typecheck && pnpm test`, check in the browser, commit.
