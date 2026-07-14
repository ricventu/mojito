# RIC-114 — Order tickets by status + colored status badges

## Problem

The Mojito session/ticket lists group by project but show the Linear lifecycle status as
plain, uncolored text. Within a project it is hard to tell at a glance which stage each
ticket is in. Two improvements:

1. **Group by status** within each project (project grouping already exists).
2. **Color the status badges** so lifecycle stage is distinguishable at a glance.

Applies to **both** lists: `SessionList` (running sessions) and `TicketList` (launchable
tickets).

## Approach (chosen)

- **Nested grouping**: project stays the top-level `<section>`; a status sub-group layer is
  added inside each project, ordered by lifecycle rank.
- **Lifecycle-stage colors**: the 9 statuses map to a small hue set that reflects
  progression (grey → blue/indigo/amber/teal → green → red/muted), not 9 unrelated hues.
- Grouping stays **client-side**, nested under the existing per-project `reduce`. The data
  pipeline (API → registry) is unchanged.

## Components

### 1. `src/lib/status.ts` — canonical lifecycle status metadata (new)

Single source of truth for status **order** and **color**:

- `STATUS_ORDER: Record<string, number>` — Backlog=0, Todo=1, To Code=2, To Review=3,
  To QA=4, To Merge=5, Done=6, Canceled=7, Duplicate=8.
- `STATUS_COLOR: Record<string, string>` — status name → color-class key (one of the 8
  hues below).
- `statusRank(name): number` — returns the rank, or a large sentinel (`Number.MAX_SAFE_INTEGER`)
  for unknown statuses so they sort last.
- `statusColorClass(name): string` — returns the color class, or a `muted` fallback for
  unknown statuses.

Hue set (color-class keys): `grey, blue, indigo, amber, teal, green, red, muted`.
Mapping: Backlog→grey, Todo→grey, To Code→blue, To Review→indigo, To QA→amber,
To Merge→teal, Done→green, Canceled→red, Duplicate→muted.

**Sync guard**: `src/server/autoAdvance.ts` (`STAGE_OF` + `GATE_STATES` + `TERMINAL_STATES`)
is the authoritative set of known lifecycle status names. A test asserts every status name
known to `autoAdvance` has an entry in both `STATUS_ORDER` and `STATUS_COLOR`, so the two
files cannot drift.

### 2. `src/lib/groupByStatus.ts` — grouping helper (new)

```ts
export function groupByStatus<T>(
  items: T[],
  getStatus: (item: T) => string,
): { status: string; items: T[] }[]
```

- Buckets items by their status string.
- Returns groups ordered by `statusRank` ascending; ties (e.g. unknown statuses sharing the
  sentinel) broken alphabetically by status name.
- Preserves the input order of items within each bucket (callers apply their own intra-group
  ordering). Does not mutate the input.

### 3. `src/components/StatusBadge.tsx` — colored status chip (new)

Mirrors the existing `StateBadge.tsx` pattern.

```tsx
export function StatusBadge({ status }: { status: string }) // <span className={`badge ${cls}`}>{status}</span>
```

`cls` comes from `statusColorClass(status)`. Used as the sub-group header in both lists.

### 4. `src/app/globals.css` — color tokens + badge rules

Add 8 hue tokens (each with a `-bg` variant, following the existing `--run/--attn/...`
pattern at `globals.css:25-29`) and matching `.badge.<hue>` rules alongside the existing
ones (`globals.css:135-139`). Dark-theme consistent. A small sub-section header style
(`.subsect`) for the status header row if needed.

### 5. `src/components/SessionList.tsx` — wiring

- Inside each project `<section>`, replace the single `orderSessions(items).map(...)` at
  `SessionList.tsx:69` with: `groupByStatus(items, s => s.launchStatus)` → for each status
  group, render a `<StatusBadge status={group.status} />` sub-header, then
  `orderSessions(group.items).map(...)` for the cards.
- Remove the now-redundant plain-text status line at `SessionList.tsx:80`
  (`<div className="status">{s.launchStatus}</div>`).
- The per-card process-state `StateBadge` (`SessionList.tsx:78`) stays unchanged.

### 6. `src/components/TicketList.tsx` — wiring

- Inside each project `<section>`, add `groupByStatus(items, t => t.statusName)` → for each
  status group render a `<StatusBadge status={group.status} />` sub-header, then the ticket
  rows. Order tickets within a group deterministically by `identifier` descending.
- Remove the inline `· {t.statusName}` text at `TicketList.tsx:47`.

## Data flow / error handling

- Unchanged pipeline: API (`/api/sessions`, tickets route) → components group client-side.
- Null project: already handled — falls back to the `NO_PROJECT = "No project"` constant.
- Empty / unknown status: `statusRank` sentinel + `muted` color → rendered last in a muted
  bucket. No crash on statuses outside the known set.

## Testing

- `tests/lib/status.test.ts` — every status known to `autoAdvance` has a `STATUS_ORDER` and
  `STATUS_COLOR` entry; ranks are unique; `statusRank`/`statusColorClass` fall back correctly
  for unknown statuses.
- `tests/lib/groupByStatus.test.ts` — groups ordered by lifecycle rank; unknown statuses sort
  last (alphabetical tie-break); empty input → `[]`; within-group input order preserved; input
  not mutated.
- No React render-test infrastructure is added (none exists in the repo; YAGNI). Only pure
  logic is unit-tested, consistent with the current `tests/` layout.

## Out of scope

- Filtering changes (`FilterBar` project filter unchanged).
- Server-side ordering (grouping stays client-side).
- Any `lime` change — this is Mojito presentation only; the shared status/stage model is
  untouched.
