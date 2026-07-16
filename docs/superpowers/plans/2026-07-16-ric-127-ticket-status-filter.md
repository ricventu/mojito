# Ticket Status Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a status filter chip row below the project chip row in the Tickets tab, colored by lifecycle hue, single-select and persisted like the project filter.

**Architecture:** Lift the ticket-filter predicate out of `TicketList` into a pure, unit-tested `src/lib/ticketFilter.ts` (which also becomes the home of the `NO_PROJECT` sentinel). Extend `FilterBar` with optional status props that render a second `.filter-chips` row of hue-colored chips. Wire the new persisted `status` state through `TicketList`.

**Tech Stack:** Next.js + TypeScript, React client components, Vitest, CSS custom properties.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Test command: `npx tsc --noEmit && npx vitest run` (must stay green; 176 existing tests).
- Run every command from the worktree: `/Users/ricventu/code/Lime/mojito/.worktrees/ricventu/ric-127-filtro-stato-ticket`.
- Single-select semantics, empty-string → `null` sentinel for persisted filter state (match the existing project filter exactly).
- Filtering is AND across project, status, and query.
- Status chips derive from statuses **present** in the loaded tickets, ordered by `statusRank`.

## File Structure

- Create `src/lib/ticketFilter.ts` — `NO_PROJECT` constant, `ticketStatuses(tickets)`, `filterTickets(tickets, criteria)`. Pure, no React.
- Create `tests/lib/ticketFilter.test.ts` — unit tests for the above.
- Modify `src/components/FilterBar.tsx` — re-export `NO_PROJECT` from the lib; add optional `statuses`/`activeStatus`/`onStatus` props + second chip row.
- Modify `src/components/TicketList.tsx` — add persisted `status` state; use `filterTickets` + `ticketStatuses`; pass status props to `FilterBar`.
- Modify `src/app/globals.css` — hue-colored status-chip rules scoped to `.filter-chips`.

---

### Task 1: Pure ticket-filter module

**Files:**
- Create: `src/lib/ticketFilter.ts`
- Test: `tests/lib/ticketFilter.test.ts`

**Interfaces:**
- Consumes: `TicketSummary` from `@/server/types`; `statusRank` from `@/lib/status`.
- Produces:
  - `NO_PROJECT: string` (value `"No project"`)
  - `ticketStatuses(tickets: TicketSummary[]): string[]`
  - `interface TicketFilter { query: string; project: string | null; status: string | null }`
  - `filterTickets(tickets: TicketSummary[], criteria: TicketFilter): TicketSummary[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/ticketFilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NO_PROJECT, ticketStatuses, filterTickets } from "@/lib/ticketFilter";
import type { TicketSummary } from "@/server/types";

function ticket(p: Partial<TicketSummary>): TicketSummary {
  return {
    identifier: "RIC-1",
    title: "Title",
    statusName: "Todo",
    statusType: "unstarted",
    project: "Mojito",
    labels: [],
    ...p,
  };
}

describe("NO_PROJECT", () => {
  it("is the shared no-project sentinel", () => {
    expect(NO_PROJECT).toBe("No project");
  });
});

describe("ticketStatuses", () => {
  it("returns [] for no tickets", () => {
    expect(ticketStatuses([])).toEqual([]);
  });

  it("returns distinct statuses ordered by lifecycle rank", () => {
    const tickets = [
      ticket({ statusName: "Done" }),
      ticket({ statusName: "To Code" }),
      ticket({ statusName: "Todo" }),
      ticket({ statusName: "To Code" }),
    ];
    expect(ticketStatuses(tickets)).toEqual(["Todo", "To Code", "Done"]);
  });

  it("sorts unknown statuses last, alphabetically among themselves", () => {
    const tickets = [
      ticket({ statusName: "Zeta" }),
      ticket({ statusName: "Alpha" }),
      ticket({ statusName: "To Code" }),
    ];
    expect(ticketStatuses(tickets)).toEqual(["To Code", "Alpha", "Zeta"]);
  });
});

describe("filterTickets", () => {
  const tickets = [
    ticket({ identifier: "RIC-1", title: "Alpha", statusName: "Todo", project: "Mojito", labels: ["Bug"] }),
    ticket({ identifier: "RIC-2", title: "Beta", statusName: "To Code", project: "Lime", labels: [] }),
    ticket({ identifier: "RIC-3", title: "Gamma", statusName: "Todo", project: null, labels: ["Feature"] }),
  ];

  it("returns all tickets when no filter is active", () => {
    expect(filterTickets(tickets, { query: "", project: null, status: null })).toHaveLength(3);
  });

  it("filters by project", () => {
    const out = filterTickets(tickets, { query: "", project: "Lime", status: null });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-2"]);
  });

  it("matches null-project tickets via the NO_PROJECT sentinel", () => {
    const out = filterTickets(tickets, { query: "", project: NO_PROJECT, status: null });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-3"]);
  });

  it("filters by status", () => {
    const out = filterTickets(tickets, { query: "", project: null, status: "Todo" });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-1", "RIC-3"]);
  });

  it("filters by query across identifier, title, status, and labels", () => {
    expect(filterTickets(tickets, { query: "ric-2", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(filterTickets(tickets, { query: "beta", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(filterTickets(tickets, { query: "to code", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(filterTickets(tickets, { query: "feature", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-3"]);
  });

  it("trims and lowercases the query", () => {
    expect(filterTickets(tickets, { query: "  ALPHA  ", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-1"]);
  });

  it("combines project AND status AND query", () => {
    const out = filterTickets(tickets, { query: "gamma", project: NO_PROJECT, status: "Todo" });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-3"]);
    expect(filterTickets(tickets, { query: "gamma", project: "Mojito", status: "Todo" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/ticketFilter.test.ts`
Expected: FAIL — cannot resolve `@/lib/ticketFilter` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/ticketFilter.ts`:

```ts
import type { TicketSummary } from "@/server/types";
import { statusRank } from "@/lib/status";

/** Sentinel project name for tickets/sessions that have no Linear project. */
export const NO_PROJECT = "No project";

/**
 * Distinct lifecycle statuses present in the tickets, ordered by lifecycle rank
 * (unknown statuses last, alphabetical tie-break — same ordering as groupByStatus).
 */
export function ticketStatuses(tickets: TicketSummary[]): string[] {
  return Array.from(new Set(tickets.map((t) => t.statusName))).sort((a, b) => {
    const byRank = statusRank(a) - statusRank(b);
    return byRank !== 0 ? byRank : a.localeCompare(b);
  });
}

export interface TicketFilter {
  query: string;
  project: string | null;
  status: string | null;
}

/** Tickets matching all active criteria (project AND status AND query). */
export function filterTickets(
  tickets: TicketSummary[],
  { query, project, status }: TicketFilter,
): TicketSummary[] {
  const q = query.trim().toLowerCase();
  return tickets.filter((t) => {
    if (project !== null && (t.project ?? NO_PROJECT) !== project) return false;
    if (status !== null && t.statusName !== status) return false;
    if (!q) return true;
    return [t.identifier, t.title, t.statusName, ...t.labels]
      .some((v) => v.toLowerCase().includes(q));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/ticketFilter.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ticketFilter.ts tests/lib/ticketFilter.test.ts
git commit -m "feat(mojito): pure ticketFilter module (ticketStatuses, filterTickets) (RIC-127)"
```

---

### Task 2: Wire the status filter into the UI

**Files:**
- Modify: `src/components/FilterBar.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/TicketList.tsx`

**Interfaces:**
- Consumes: `NO_PROJECT`, `ticketStatuses`, `filterTickets` from `@/lib/ticketFilter` (Task 1); `statusColorClass` from `@/lib/status`.
- Produces: `FilterBar` now accepts optional `statuses?: string[]`, `activeStatus?: string | null`, `onStatus?: (s: string | null) => void`. `NO_PROJECT` is re-exported from `FilterBar` (existing consumers `TicketList` and `SessionList` keep importing it from `./FilterBar`).

- [ ] **Step 1: Update `FilterBar.tsx` — re-export NO_PROJECT and add the status row**

Replace the whole file `src/components/FilterBar.tsx` with:

```tsx
"use client";
import { statusColorClass } from "@/lib/status";
export { NO_PROJECT } from "@/lib/ticketFilter";

export default function FilterBar(
  { query, onQuery, projects, active, onProject, statuses, activeStatus, onStatus, placeholder, action }:
  {
    query: string;
    onQuery: (q: string) => void;
    projects: string[];
    active: string | null;
    onProject: (p: string | null) => void;
    statuses?: string[];
    activeStatus?: string | null;
    onStatus?: (s: string | null) => void;
    placeholder?: string;
    action?: React.ReactNode;
  },
) {
  return (
    <div className="filter">
      <div className="filter-top">
        <input
          className="search"
          type="search"
          inputMode="search"
          placeholder={placeholder ?? "Search…"}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        {action}
      </div>
      {(projects.length > 1 || active !== null) && (
        <div className="filter-chips">
          <button className={`chip toggle${active === null ? " on" : ""}`} onClick={() => onProject(null)}>All</button>
          {projects.map((p) => (
            <button key={p} className={`chip toggle${active === p ? " on" : ""}`} onClick={() => onProject(p)}>{p}</button>
          ))}
        </div>
      )}
      {statuses && onStatus && (statuses.length > 1 || (activeStatus ?? null) !== null) && (
        <div className="filter-chips">
          <button className={`chip toggle${(activeStatus ?? null) === null ? " on" : ""}`} onClick={() => onStatus(null)}>All</button>
          {statuses.map((s) => (
            <button
              key={s}
              className={`chip toggle ${statusColorClass(s)}${activeStatus === s ? " on" : ""}`}
              onClick={() => onStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note: `NO_PROJECT` is no longer declared here — it now lives in `@/lib/ticketFilter` and is re-exported so `TicketList` and `SessionList` keep importing `{ NO_PROJECT } from "./FilterBar"` unchanged.

- [ ] **Step 2: Add hue-colored status-chip CSS**

In `src/app/globals.css`, immediately AFTER the existing line
`.chip.on { color: var(--run); border-color: color-mix(in srgb, var(--run) 40%, transparent); }`
add:

```css
/* Colored status chips (Tickets status filter): hue text + border when inactive,
   filled with the hue background when active. The "All" chip has no hue class,
   so it keeps the default .chip / .chip.on styling. Hues match src/lib/status.ts. */
.filter-chips .chip.grey   { color: var(--wait);       border-color: var(--border-hi); }
.filter-chips .chip.blue   { color: var(--run);        border-color: color-mix(in srgb, var(--run) 40%, transparent); }
.filter-chips .chip.indigo { color: var(--indigo);     border-color: color-mix(in srgb, var(--indigo) 45%, transparent); }
.filter-chips .chip.amber  { color: var(--attn);       border-color: color-mix(in srgb, var(--attn) 45%, transparent); }
.filter-chips .chip.teal   { color: var(--teal);       border-color: color-mix(in srgb, var(--teal) 45%, transparent); }
.filter-chips .chip.green  { color: var(--ok);         border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.filter-chips .chip.red    { color: var(--err);        border-color: color-mix(in srgb, var(--err) 40%, transparent); }
.filter-chips .chip.muted  { color: var(--text-faint); border-color: var(--border); }
.filter-chips .chip.grey.on   { background: var(--wait-bg); }
.filter-chips .chip.blue.on   { background: var(--run-bg); }
.filter-chips .chip.indigo.on { background: var(--indigo-bg); }
.filter-chips .chip.amber.on  { background: var(--attn-bg); }
.filter-chips .chip.teal.on   { background: var(--teal-bg); }
.filter-chips .chip.green.on  { background: var(--ok-bg); }
.filter-chips .chip.red.on    { background: var(--err-bg); }
.filter-chips .chip.muted.on  { background: var(--surface-hi); }
```

- [ ] **Step 3: Wire the status filter into `TicketList.tsx`**

3a. Add the import after the existing `FilterBar` import (line 4):

```tsx
import { filterTickets, ticketStatuses } from "@/lib/ticketFilter";
```

3b. After the existing `setProject` line, add the persisted status state:

```tsx
  const [statusRaw, setStatusRaw] = usePersistedState("mojito-tickets-status", "");
  const status = statusRaw === "" ? null : statusRaw;
  const setStatus = (s: string | null) => setStatusRaw(s ?? "");
```

3c. After the existing `projects` useMemo, derive the status list:

```tsx
  const statuses = useMemo(() => ticketStatuses(tickets), [tickets]);
```

3d. Replace the inline `q` + `filtered` block:

```tsx
  const q = query.trim().toLowerCase();
  const filtered = tickets.filter((t) => {
    if (project !== null && (t.project ?? NO_PROJECT) !== project) return false;
    if (!q) return true;
    return [t.identifier, t.title, t.statusName, ...t.labels]
      .some((v) => v.toLowerCase().includes(q));
  });
```

with:

```tsx
  const filtered = filterTickets(tickets, { query, project, status });
```

3e. Pass the status props to `<FilterBar>`. Replace:

```tsx
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          placeholder="Filter tickets…"
        />
```

with:

```tsx
        <FilterBar
          query={query} onQuery={setQuery}
          projects={projects} active={project} onProject={setProject}
          statuses={statuses} activeStatus={status} onStatus={setStatus}
          placeholder="Filter tickets…"
        />
```

Leave the `projects` useMemo, the `groups` reduce (both still use `NO_PROJECT`), and the JSX rendering below untouched.

- [ ] **Step 4: Verify types and the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`, then all tests pass (176 existing + the new `ticketFilter` tests, 0 failures).

- [ ] **Step 5: Optional manual smoke check**

If verifying visually: `npm run dev` inside the worktree (use a free port, e.g. `PORT=8701 npm run dev` — do NOT reuse the main checkout's dev port), open the Tickets tab, confirm a second colored chip row appears below the projects row, single-select toggles filter the list (AND with project + search), and the selection survives a reload.

- [ ] **Step 6: Commit**

```bash
git add src/components/FilterBar.tsx src/components/TicketList.tsx src/app/globals.css
git commit -m "feat(mojito): add ticket status filter row (RIC-127)"
```

---

## Self-Review

**Spec coverage:**
- Second chip row below projects → Task 2 Step 1 (second `.filter-chips` block).
- Present-only statuses ordered by rank → Task 1 `ticketStatuses`, tested.
- Single-select mirroring project → `activeStatus`/`onStatus` toggle + `All` chip.
- Colored chips via `statusColorClass`, filled when active → Task 2 Steps 1 + 2.
- AND filtering (project + status + query) → Task 1 `filterTickets`, tested (combined case).
- Persistence at `mojito-tickets-status` → Task 2 Step 3b.
- Row visibility rule → Task 2 Step 1 (`statuses.length > 1 || activeStatus != null`).
- `NO_PROJECT` relocation + re-export (TicketList & SessionList unaffected) → Task 1 + Task 2 Step 1.

**Placeholder scan:** No TBD/TODO; every code step shows full code.

**Type consistency:** `TicketFilter` fields (`query`/`project`/`status`) match the object passed in Task 2 Step 3d. `ticketStatuses`/`filterTickets`/`NO_PROJECT` names identical across tasks. `statusColorClass` hue names (`grey`/`blue`/`indigo`/`amber`/`teal`/`green`/`red`/`muted`) match the CSS classes added in Task 2 Step 2 and `src/lib/status.ts`.
