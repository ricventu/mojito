# Order Tickets by Status + Colored Status Badges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In both Mojito lists, sub-group tickets/sessions by Linear lifecycle status within each project, and show each status as a colored badge.

**Architecture:** Add a canonical status-metadata module (`src/lib/status.ts`: order + color, guarded in sync with `src/server/autoAdvance.ts`), two pure ordering/grouping helpers (`src/lib/groupByStatus.ts`, `src/lib/orderTickets.ts`), a presentational `StatusBadge` component with CSS color tokens, then wire both list components to render a status sub-group layer inside each existing per-project `<section>`.

**Tech Stack:** Next.js (App Router, `"use client"` components), TypeScript, React, vitest, hand-written semantic CSS in `src/app/globals.css` (dark-only, CSS custom properties). Path alias `@/` → `src/`.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Grouping stays **client-side**; the API/data pipeline is unchanged.
- The 9 lifecycle statuses and their names are authoritative in `src/server/autoAdvance.ts` (`STAGE_OF`): `Backlog, Todo, To Code, To Review, To QA, To Merge, Done, Canceled, Duplicate`. `status.ts` must stay in sync with them (test-guarded).
- Status order (rank): Backlog=0, Todo=1, To Code=2, To Review=3, To QA=4, To Merge=5, Done=6, Canceled=7, Duplicate=8. Unknown statuses sort last.
- Verify command (run from the worktree root): `npx tsc --noEmit && npx vitest run`.
- No React render-test infrastructure exists; do not add it. Test pure logic only.
- This is Mojito-only presentation — no `lime` change, no change to the shared status/stage model.

---

### Task 1: Canonical status metadata (`src/lib/status.ts`)

**Files:**
- Create: `src/lib/status.ts`
- Modify: `src/server/autoAdvance.ts` (export the known-status list for the sync guard)
- Test: `tests/lib/status.test.ts`

**Interfaces:**
- Consumes: `KNOWN_STATUSES` from `@/server/autoAdvance` (added in Step 1).
- Produces:
  - `STATUS_ORDER: Record<string, number>`
  - `STATUS_COLOR: Record<string, string>` (values are hue keys: `grey|blue|indigo|amber|teal|green|red|muted`)
  - `statusRank(name: string): number` — rank, or `Number.MAX_SAFE_INTEGER` for unknown
  - `statusColorClass(name: string): string` — hue key, or `"muted"` for unknown

- [ ] **Step 1: Export the known-status list from `autoAdvance.ts`**

Add this line immediately after the `STAGE_OF` definition (after line 17), so the authoritative status set is importable without exporting the map itself:

```ts
// The authoritative set of lifecycle status names (keys of STAGE_OF). Consumed by
// src/lib/status.ts's sync-guard test so status metadata cannot drift from the model.
export const KNOWN_STATUSES: string[] = Object.keys(STAGE_OF);
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KNOWN_STATUSES } from "@/server/autoAdvance";
import { STATUS_ORDER, STATUS_COLOR, statusRank, statusColorClass } from "@/lib/status";

describe("status metadata", () => {
  it("covers every status the server model knows", () => {
    for (const name of KNOWN_STATUSES) {
      expect(STATUS_ORDER, `order for ${name}`).toHaveProperty(name);
      expect(STATUS_COLOR, `color for ${name}`).toHaveProperty(name);
    }
  });

  it("assigns a unique rank to each status", () => {
    const ranks = Object.values(STATUS_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("orders the lifecycle Backlog → Duplicate", () => {
    expect(statusRank("Backlog")).toBeLessThan(statusRank("To Code"));
    expect(statusRank("To Code")).toBeLessThan(statusRank("Done"));
    expect(statusRank("Done")).toBeLessThan(statusRank("Duplicate"));
  });

  it("sorts unknown statuses last and colors them muted", () => {
    expect(statusRank("Whatever")).toBe(Number.MAX_SAFE_INTEGER);
    expect(statusRank("Whatever")).toBeGreaterThan(statusRank("Duplicate"));
    expect(statusColorClass("Whatever")).toBe("muted");
  });

  it("returns the mapped color for a known status", () => {
    expect(statusColorClass("To Code")).toBe("blue");
    expect(statusColorClass("Done")).toBe("green");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/status.test.ts`
Expected: FAIL — cannot resolve `@/lib/status` (and `KNOWN_STATUSES` if Step 1 skipped).

- [ ] **Step 4: Write `src/lib/status.ts`**

```ts
// Canonical lifecycle-status presentation metadata: display order + color hue.
// Kept in sync with src/server/autoAdvance.ts (STAGE_OF) by tests/lib/status.test.ts.
// Hue keys map to `.badge.<hue>` rules in src/app/globals.css.

export const STATUS_ORDER: Record<string, number> = {
  Backlog: 0,
  Todo: 1,
  "To Code": 2,
  "To Review": 3,
  "To QA": 4,
  "To Merge": 5,
  Done: 6,
  Canceled: 7,
  Duplicate: 8,
};

export const STATUS_COLOR: Record<string, string> = {
  Backlog: "grey",
  Todo: "grey",
  "To Code": "blue",
  "To Review": "indigo",
  "To QA": "amber",
  "To Merge": "teal",
  Done: "green",
  Canceled: "red",
  Duplicate: "muted",
};

/** Rank for ordering status groups; unknown statuses sort last. */
export function statusRank(name: string): number {
  return STATUS_ORDER[name] ?? Number.MAX_SAFE_INTEGER;
}

/** Badge color-hue class for a status; unknown statuses are muted. */
export function statusColorClass(name: string): string {
  return STATUS_COLOR[name] ?? "muted";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/status.ts src/server/autoAdvance.ts tests/lib/status.test.ts
git commit -m "feat(mojito): canonical lifecycle status order + color metadata (RIC-114)"
```

---

### Task 2: Group-by-status helper (`src/lib/groupByStatus.ts`)

**Files:**
- Create: `src/lib/groupByStatus.ts`
- Test: `tests/lib/groupByStatus.test.ts`

**Interfaces:**
- Consumes: `statusRank` from `@/lib/status`.
- Produces: `groupByStatus<T>(items: T[], getStatus: (item: T) => string): { status: string; items: T[] }[]`
  — groups ordered by `statusRank` ascending, ties broken alphabetically by status name; item order within a group preserved; input not mutated.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/groupByStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupByStatus } from "@/lib/groupByStatus";

type Item = { id: string; status: string };
const get = (i: Item) => i.status;

describe("groupByStatus", () => {
  it("returns [] for empty input", () => {
    expect(groupByStatus([] as Item[], get)).toEqual([]);
  });

  it("orders groups by lifecycle rank", () => {
    const items: Item[] = [
      { id: "a", status: "Done" },
      { id: "b", status: "To Code" },
      { id: "c", status: "Backlog" },
    ];
    expect(groupByStatus(items, get).map((g) => g.status)).toEqual([
      "Backlog", "To Code", "Done",
    ]);
  });

  it("sorts unknown statuses last, alphabetically among themselves", () => {
    const items: Item[] = [
      { id: "a", status: "Zeta" },
      { id: "b", status: "Alpha" },
      { id: "c", status: "To Code" },
    ];
    expect(groupByStatus(items, get).map((g) => g.status)).toEqual([
      "To Code", "Alpha", "Zeta",
    ]);
  });

  it("preserves input order of items within a group", () => {
    const items: Item[] = [
      { id: "a", status: "To Code" },
      { id: "b", status: "To Code" },
      { id: "c", status: "To Code" },
    ];
    expect(groupByStatus(items, get)[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const items: Item[] = [
      { id: "a", status: "Done" },
      { id: "b", status: "Backlog" },
    ];
    const copy = [...items];
    groupByStatus(items, get);
    expect(items).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/groupByStatus.test.ts`
Expected: FAIL — cannot resolve `@/lib/groupByStatus`.

- [ ] **Step 3: Write `src/lib/groupByStatus.ts`**

```ts
import { statusRank } from "@/lib/status";

/**
 * Bucket items by their status string and return the buckets ordered by lifecycle
 * rank (unknown statuses last, alphabetical tie-break). Item order within each bucket
 * is the input order; the input array is not mutated.
 */
export function groupByStatus<T>(
  items: T[],
  getStatus: (item: T) => string,
): { status: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const status = getStatus(item);
    const bucket = buckets.get(status);
    if (bucket) bucket.push(item);
    else buckets.set(status, [item]);
  }
  return Array.from(buckets, ([status, groupItems]) => ({ status, items: groupItems }))
    .sort((a, b) => {
      const byRank = statusRank(a.status) - statusRank(b.status);
      return byRank !== 0 ? byRank : a.status.localeCompare(b.status);
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/groupByStatus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/groupByStatus.ts tests/lib/groupByStatus.test.ts
git commit -m "feat(mojito): groupByStatus helper ordered by lifecycle rank (RIC-114)"
```

---

### Task 3: Ticket intra-group ordering (`src/lib/orderTickets.ts`)

**Files:**
- Create: `src/lib/orderTickets.ts`
- Test: `tests/lib/orderTickets.test.ts`

**Interfaces:**
- Consumes: `TicketSummary` from `@/server/types`.
- Produces: `orderTickets(tickets: TicketSummary[]): TicketSummary[]` — a new array sorted by `identifier` descending with numeric awareness (RIC-114 before RIC-9); input not mutated.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/orderTickets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { orderTickets } from "@/lib/orderTickets";
import type { TicketSummary } from "@/server/types";

function t(identifier: string): TicketSummary {
  return { identifier, title: "", statusName: "", statusType: "", project: null, labels: [] };
}

describe("orderTickets", () => {
  it("returns empty input unchanged", () => {
    expect(orderTickets([])).toEqual([]);
  });

  it("orders by identifier descending, numeric-aware", () => {
    const input = [t("RIC-9"), t("RIC-114"), t("RIC-20")];
    expect(orderTickets(input).map((x) => x.identifier)).toEqual(["RIC-114", "RIC-20", "RIC-9"]);
  });

  it("does not mutate the input array", () => {
    const input = [t("RIC-1"), t("RIC-2")];
    const copy = [...input];
    orderTickets(input);
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/orderTickets.test.ts`
Expected: FAIL — cannot resolve `@/lib/orderTickets`.

- [ ] **Step 3: Write `src/lib/orderTickets.ts`**

```ts
import type { TicketSummary } from "@/server/types";

/**
 * Order tickets newest-first by identifier, numeric-aware so RIC-114 precedes RIC-9.
 * Returns a new array; does not mutate the input.
 */
export function orderTickets(tickets: TicketSummary[]): TicketSummary[] {
  return [...tickets].sort((a, b) =>
    b.identifier.localeCompare(a.identifier, undefined, { numeric: true }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/orderTickets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/orderTickets.ts tests/lib/orderTickets.test.ts
git commit -m "feat(mojito): orderTickets helper, numeric-desc by identifier (RIC-114)"
```

---

### Task 4: StatusBadge component + CSS color tokens

**Files:**
- Create: `src/components/StatusBadge.tsx`
- Modify: `src/app/globals.css` (add 2 hue tokens + 8 `.badge.<hue>` rules + a `.substatus` header style)

**Interfaces:**
- Consumes: `statusColorClass` from `@/lib/status`.
- Produces: `StatusBadge` (default export) — `StatusBadge({ status }: { status: string })` renders `<span className={`badge <hue>`}>{status}</span>` (no dot).

No unit test: this is presentational and there is no render-test infra. Verification is `npx tsc --noEmit` compiling clean and the badge rendering once wired in Tasks 5–6.

- [ ] **Step 1: Write `src/components/StatusBadge.tsx`**

```tsx
import { statusColorClass } from "@/lib/status";

/** Colored badge for a Linear lifecycle status (e.g. "To Code"). */
export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusColorClass(status)}`}>{status}</span>;
}
```

- [ ] **Step 2: Add the new color tokens to `globals.css`**

In `src/app/globals.css`, inside the `:root { ... }` block, immediately after the existing state-color tokens (after line 29, the `--wait` line), add the two hues that don't already exist as tokens:

```css
  --indigo: #a08cff; --indigo-bg: #20203b;
  --teal: #3fd0c9;   --teal-bg: #0e2b2a;
```

- [ ] **Step 3: Add the status-hue badge rules to `globals.css`**

In the `/* ---- State badges ---- */` section, immediately after the existing `.badge.wait` rule (after line 139), add:

```css
/* ---- Status badges (Linear lifecycle) ---- */
.badge.grey   { color: var(--wait);       background: var(--wait-bg);   border-color: var(--border-hi); }
.badge.blue   { color: var(--run);        background: var(--run-bg);    border-color: color-mix(in srgb, var(--run) 40%, transparent); }
.badge.indigo { color: var(--indigo);     background: var(--indigo-bg); border-color: color-mix(in srgb, var(--indigo) 45%, transparent); }
.badge.amber  { color: var(--attn);       background: var(--attn-bg);   border-color: color-mix(in srgb, var(--attn) 45%, transparent); }
.badge.teal   { color: var(--teal);       background: var(--teal-bg);   border-color: color-mix(in srgb, var(--teal) 45%, transparent); }
.badge.green  { color: var(--ok);         background: var(--ok-bg);     border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.badge.red    { color: var(--err);        background: var(--err-bg);    border-color: color-mix(in srgb, var(--err) 40%, transparent); }
.badge.muted  { color: var(--text-faint); background: var(--surface-hi); border-color: var(--border); }
```

- [ ] **Step 4: Add the status sub-group header style to `globals.css`**

Immediately after the `.sect` rules (after line 104, `.sect:first-child`), add:

```css
/* ---- Status sub-group header (within a project section) ---- */
.substatus { margin: 12px 2px 8px; }
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatusBadge.tsx src/app/globals.css
git commit -m "feat(mojito): StatusBadge component + lifecycle status color tokens (RIC-114)"
```

---

### Task 5: Wire status sub-groups into `SessionList`

**Files:**
- Modify: `src/components/SessionList.tsx`

**Interfaces:**
- Consumes: `groupByStatus` from `@/lib/groupByStatus`, `StatusBadge` from `./StatusBadge`, existing `orderSessions` from `@/lib/orderSessions`.

- [ ] **Step 1: Add imports**

At the top of `src/components/SessionList.tsx`, alongside the existing imports (after the `orderSessions` import at line 7), add:

```tsx
import { groupByStatus } from "@/lib/groupByStatus";
import StatusBadge from "./StatusBadge";
```

- [ ] **Step 2: Replace the per-project render body with status sub-groups**

Replace the current section body — the block from `{orderSessions(items).map((s) => {` (line 69) through its closing `})}` (line 97) — so each project section renders status sub-groups, each headed by a `StatusBadge`, with `orderSessions` applied inside the sub-group. The full replacement for the `<section>` contents (keep the surrounding `{Object.entries(groups).map(([proj, items]) => (` and `<h4 className="sect">{proj}</h4>`):

```tsx
          {groupByStatus(items, (s) => s.launchStatus).map((group) => (
            <div key={group.status}>
              <div className="substatus"><StatusBadge status={group.status} /></div>
              {orderSessions(group.items).map((s) => {
                const active = s.state === "running" || s.state === "needs-input" || s.state === "starting";
                return (
                  <div key={s.id} className={`card${s.state === "needs-input" ? " attn" : ""}`}>
                    <div className="tap" onClick={() => onOpen(s)}>
                      <div className="row">
                        <span className="id">{s.ticket}</span>
                        <span className="grow" />
                        <StateBadge state={s.state} />
                      </div>
                      {s.title && <div className="session-title">{s.title}</div>}
                      {s.message && <div className="title">{s.message}</div>}
                      <div className="meta">
                        <span className="chip">{s.model} · {s.effort}</span>
                        <button className={`chip toggle${s.autoAdvance ? " on" : ""}`} onClick={(e) => toggleAuto(e, s)}>
                          auto: {s.autoAdvance ? "on" : "off"}
                        </button>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn ghost sm grow" onClick={() => onOpen(s)}>Open</button>
                      <button className={`btn sm${active ? " danger" : ""}`} onClick={() => dismiss(s)}>
                        {active ? "Kill" : "Dismiss"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
```

Note: the old `<div className="status">{s.launchStatus}</div>` line (formerly line 80) is intentionally dropped — the `StatusBadge` sub-group header now carries the status.

- [ ] **Step 3: Verify compile + full test suite still green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (previous 76 + the new lib tests, 0 failures).

- [ ] **Step 4: Commit**

```bash
git add src/components/SessionList.tsx
git commit -m "feat(mojito): sub-group sessions by status with colored badge (RIC-114)"
```

---

### Task 6: Wire status sub-groups into `TicketList`

**Files:**
- Modify: `src/components/TicketList.tsx`

**Interfaces:**
- Consumes: `groupByStatus` from `@/lib/groupByStatus`, `orderTickets` from `@/lib/orderTickets`, `StatusBadge` from `./StatusBadge`.

- [ ] **Step 1: Add imports**

At the top of `src/components/TicketList.tsx`, after the type import at line 5, add:

```tsx
import { groupByStatus } from "@/lib/groupByStatus";
import { orderTickets } from "@/lib/orderTickets";
import StatusBadge from "./StatusBadge";
```

- [ ] **Step 2: Replace the per-project render body with status sub-groups**

Replace the current `{items.map((t) => ( ... ))}` block (lines 45–53) inside the `<section>` with status sub-groups (keep the surrounding `{Object.entries(groups).map(([project, items]) => (` and `<h4 className="sect">{project}</h4>`). Drop the inline `· {t.statusName}` text — the sub-group header carries the status:

```tsx
          {groupByStatus(items, (t) => t.statusName).map((group) => (
            <div key={group.status}>
              <div className="substatus"><StatusBadge status={group.status} /></div>
              {orderTickets(group.items).map((t) => (
                <button key={t.identifier} className="card tap" onClick={() => setPicked(t)}>
                  <div><span className="id">{t.identifier}</span></div>
                  <div className="title">{t.title}</div>
                  {t.labels.length > 0 && (
                    <div className="meta">{t.labels.map((l) => <span key={l} className="chip">{l}</span>)}</div>
                  )}
                </button>
              ))}
            </div>
          ))}
```

- [ ] **Step 3: Verify compile + full test suite still green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add src/components/TicketList.tsx
git commit -m "feat(mojito): sub-group tickets by status with colored badge (RIC-114)"
```

---

## Final verification

- [ ] Run `npx tsc --noEmit && npx vitest run` from the worktree root — clean typecheck, all tests pass.
- [ ] (Optional, visual) `npm run dev` and confirm both tabs show project → status sub-groups with colored badges, and no leftover plain-text status line/inline status text.

## Notes for the implementer

- Path alias `@/` maps to `src/`. Client components carry `"use client"` at the top — do not remove it.
- `src/app/globals.css` is the single global stylesheet; the `.badge` base rule (uppercase, pill) already exists — the new `.badge.<hue>` rules only set colors.
- Sessions expose status as `launchStatus` and project as `projectName`; tickets expose status as `statusName` and project as `project`. This asymmetry is why `groupByStatus` takes a status accessor.
