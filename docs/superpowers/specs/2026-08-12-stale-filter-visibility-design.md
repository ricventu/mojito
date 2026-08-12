# Stale filter visibility — Design

## Problem

A session was launched and never appeared in the list. The cause was a leftover `182` in
the search box, persisted in `localStorage` under `mojito-list-q` from an earlier visit.
This has happened more than once.

Two properties combine to make it invisible:

1. **The filter bar scrolls away.** `FilterBar` renders once at the top of `UnifiedList`.
   Scroll down a phone screen looking for the new session and the box holding `182` is no
   longer on screen. Nothing else on the page says the list is narrowed.
2. **A filtered list looks like a complete list.** `RIC-182` itself still matched, so the
   list was populated. The `No matching tickets or sessions.` hint
   (`src/components/UnifiedList.tsx:124`) only fires when *nothing* matches — precisely not
   the case that bites. The absence of one session among many reads as "it did not launch",
   not as "it is filtered out".

Filter persistence was deliberate (`docs/superpowers/plans/2026-07-15-persist-filter-search-state.md`).
The persistence is not the mistake; persisting state that the UI then stops showing is.

A second, independent defect surfaced while diagnosing this, and is fixed here because it
is the other half of the same report ("no feedback"): `LaunchSheet.start()` has neither a
pending state nor a `try`/`catch`.

## Goals

- An active filter is evident wherever you are scrolled to.
- Dropping one stale filter does not cost you the others.
- Launching a session gives immediate feedback, and a failed launch says so.

## Non-goals

- Changing whether filters persist. They still do.
- Fixing the two pre-existing `resolveDocPath` failures (macOS `/var` symlink in the test
  fixture, unrelated to this work).

## Design

### 1. `activeFilters` — the model

New pure module `src/lib/activeFilters.ts`. No React, so it is unit-testable under the
`node` vitest environment, matching how `unifiedRows`, `ticketFilter` and `sessionFilter`
already split model from component.

```ts
export type FilterKey = "query" | "project" | "status" | "mine" | "sessions";

export interface ActiveFilter {
  key: FilterKey;
  label: string;
}

export interface FilterState {
  query: string;
  project: string | null;
  status: string | null;
  mine: boolean;
  sessionsOnly: boolean;
}

export function activeFilters(state: FilterState): ActiveFilter[];
```

A filter is active when it narrows the list:

| Key | Active when | Label |
| --- | --- | --- |
| `query` | `query.trim() !== ""` | the trimmed query |
| `project` | `project !== null` | the project name |
| `status` | `status !== null` | the status name |
| `mine` | `mine` | `Mine` |
| `sessions` | `sessionsOnly` | `Sessions` |

Order is fixed and matches the table: `query` leads because it is the one that scrolls out
of sight. An empty array means the list is showing everything.

Whitespace-only queries count as absent, matching `filterTickets`/`filterSessions`, which
both narrow on `query.trim()`.

### 2. `ActiveFilters` — the bar

New presentational component `src/components/ActiveFilters.tsx`:

```ts
{ filters: ActiveFilter[]; onClear: (key: FilterKey) => void; onClearAll: () => void }
```

Returns `null` for an empty array, so "no bar when nothing is filtered" lives in one place
rather than as a condition spread across `UnifiedList`.

Otherwise it renders one `.chip` per filter, each carrying its label and a `✕`, with
`aria-label="Remove filter <label>"` — the label alone is not a usable accessible name for
a button whose job is removal. Tapping a chip calls `onClear(key)`; only that filter goes.

`Clear all` renders only when `filters.length > 1`. With a single filter its own `✕` is
already clear-all, and a second control would be noise.

`UnifiedList` mounts the bar between `FilterBar` and the project sections, and maps
`onClear` to the matching setter. `onClearAll` resets all five.

### 3. Mine defaults OFF

`src/components/UnifiedList.tsx:50-52`:

```ts
const [mineRaw, setMineRaw] = usePersistedState("mojito-list-mine", "0");
const mine = mineRaw === "1";
```

Two changes. The initial value flips to `"0"`, so the landing view is the whole board.
And the predicate becomes `=== "1"` rather than `!== "0"`: with an off default, an
unrecognised stored value should read as off, not on.

`usePersistedState` only writes on change, so the new default reaches any browser that
never touched the toggle. A browser where Mine *was* toggled keeps its stored value —
an explicit choice outranks a default. No test pins the current default.

With Mine off by default, "deviates from the default" and "narrows the list" become the
same set, which is why `activeFilters` can treat Mine like every other filter instead of
special-casing the baseline.

Mine cannot itself hide a session — `buildUnifiedRows` receives `sessions` unscoped, so a
session whose ticket is scoped out falls through to the `No ticket` group rather than
disappearing. It is in the bar for consistency, not because it caused this bug.

### 4. Sticky placement

```css
.active-filters {
  position: sticky; top: 0; z-index: 30;
  margin: 0 -12px; padding: 8px 12px;
  background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; gap: 6px; align-items: center; overflow-x: auto;
}
```

- `z-index: 30` sits under `.nav` (40) and sheets (100).
- No ancestor carries `overflow` or `transform`, so sticky resolves against the viewport.
- `margin: 0 -12px` cancels `.pad`'s padding so the bar spans the full width and its
  border reads as a divider.
- `overflow-x: auto` because five chips do not fit a phone width, matching `.filter-chips`.
- Chips reuse the existing `.chip.on` lime treatment: these are the active filters.

### 5. Launch feedback

`src/components/LaunchSheet.tsx`. `start()`, `startCustom()` and `startShell()` each get
what `submitVerdict()` twenty lines above them already has: a pending state that disables
the button and names what is happening, and a `try`/`catch` so a thrown `fetch` surfaces
instead of vanishing.

This matters most for `start()`, whose `POST /api/sessions` runs `getIssueContent` against
Linear and then downloads the ticket's assets before it answers — seconds during which the
button today looks dead.

One shared `launching: "work" | "custom" | "shell" | null` state, mirroring how a single
`verdictPending` covers the three verdict buttons.

`setErr(await res.text())` also becomes a JSON-aware read of `{ error }` with the status
code as fallback, as `submitVerdict` does — the route answers JSON, so today the raw
`{"error":"duplicate"}` is what reaches the user.

## Testing

`tests/lib/activeFilters.test.ts`:

- each filter alone yields exactly its own entry, with the right label
- no filters yields `[]`
- all five yields all five in the documented order
- a whitespace-only query counts as absent
- `project`/`status` set to `""` are active — their type is `string | null`, where `null`
  alone means "unset", unlike `query`, which is a bare `string` and so uses emptiness to
  mean the same thing. `UnifiedList` maps `""` to `null` before it ever reaches here
  (`projectRaw === "" ? null : projectRaw`), so this pins the contract rather than a
  reachable state.

Components stay untested, as they are throughout this codebase — vitest runs
`environment: "node"` and `include: ["tests/**/*.test.ts"]`, so there is no DOM and no
`.tsx` is collected.

Full command: `npx tsc --noEmit && npx vitest run`.

Baseline before this work: **750 passing, 2 failing** — the two pre-existing
`resolveDocPath` failures described under Non-goals. That count must not get worse.

## Follow-up noted, not done here

`CLAUDE.md` says tests live under `tests/server/`; `tests/lib/` and `tests/client/` also
exist and hold 25 and 7 files. Worth a one-line correction in a separate change.
