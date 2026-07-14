# Session Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order sessions within each project group by ticket cluster, newest-first.

**Architecture:** A pure client-side helper `orderSessions(items)` clusters a project group's sessions by `ticket`, sorts newest-first within and across clusters (by `createdAt`, tie-broken by `id`), and returns a flat list. `SessionList` calls it in its grouping step. No backend, API, or data-shape change.

**Tech Stack:** TypeScript, React (Next.js), Vitest (node environment).

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Sort key is `SessionMeta.createdAt` (ISO string) only — no new timestamp field.
- Newest-first everywhere. Deterministic: tie-break equal `createdAt` by `id`, descending.
- ISO timestamp strings are compared with plain `<`/`>` (lexicographic == chronological for identical ISO format) — NOT `localeCompare`, to avoid locale surprises.
- Adjacency only — no new ticket sub-header/divider in the UI.
- Project grouping and all other `SessionList` behaviour unchanged.

---

### Task 1: `orderSessions` helper + unit tests

**Files:**
- Create: `src/lib/orderSessions.ts`
- Test: `tests/lib/orderSessions.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` from `@/server/types` (fields used: `id`, `ticket`, `createdAt`).
- Produces: `export function orderSessions(items: SessionMeta[]): SessionMeta[]` — returns a new array; does not mutate the input.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/orderSessions.test.ts
import { describe, it, expect } from "vitest";
import { orderSessions } from "@/lib/orderSessions";
import type { SessionMeta } from "@/server/types";

// minimal SessionMeta factory — only the fields orderSessions reads matter
function s(id: string, ticket: string, createdAt: string): SessionMeta {
  return {
    id, ticket, createdAt,
    launchStatus: "", model: "", effort: "low", autoAdvance: false,
    state: "running", cwd: "", title: "", labels: [],
  } as SessionMeta;
}

describe("orderSessions", () => {
  it("returns empty and single-element inputs unchanged", () => {
    expect(orderSessions([])).toEqual([]);
    const one = [s("a", "RIC-1", "2026-07-14T10:00:00.000Z")];
    expect(orderSessions(one).map((x) => x.id)).toEqual(["a"]);
  });

  it("clusters sessions of the same ticket adjacently", () => {
    const input = [
      s("a", "RIC-1", "2026-07-14T10:00:00.000Z"),
      s("b", "RIC-2", "2026-07-14T11:00:00.000Z"),
      s("c", "RIC-1", "2026-07-14T09:00:00.000Z"),
    ];
    const tickets = orderSessions(input).map((x) => x.ticket);
    // RIC-1 sessions must be contiguous, RIC-2 sessions contiguous
    expect(tickets).toEqual(["RIC-2", "RIC-1", "RIC-1"]);
  });

  it("orders sessions newest-first within a cluster", () => {
    const input = [
      s("old", "RIC-1", "2026-07-14T09:00:00.000Z"),
      s("new", "RIC-1", "2026-07-14T12:00:00.000Z"),
      s("mid", "RIC-1", "2026-07-14T10:00:00.000Z"),
    ];
    expect(orderSessions(input).map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  it("orders clusters by their newest session, newest-first", () => {
    const input = [
      s("a1", "RIC-1", "2026-07-14T09:00:00.000Z"),
      s("a2", "RIC-1", "2026-07-14T10:00:00.000Z"), // RIC-1 newest = 10:00
      s("b1", "RIC-2", "2026-07-14T12:00:00.000Z"), // RIC-2 newest = 12:00
    ];
    expect(orderSessions(input).map((x) => x.ticket)).toEqual(["RIC-2", "RIC-1", "RIC-1"]);
  });

  it("tie-breaks equal createdAt by id, descending, deterministically", () => {
    const t = "2026-07-14T10:00:00.000Z";
    const input = [
      s("a", "RIC-1", t),
      s("c", "RIC-1", t),
      s("b", "RIC-1", t),
    ];
    expect(orderSessions(input).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = [
      s("a", "RIC-1", "2026-07-14T09:00:00.000Z"),
      s("b", "RIC-1", "2026-07-14T12:00:00.000Z"),
    ];
    const before = input.map((x) => x.id);
    orderSessions(input);
    expect(input.map((x) => x.id)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/orderSessions.test.ts`
Expected: FAIL — cannot resolve `@/lib/orderSessions` / `orderSessions is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/orderSessions.ts
import type { SessionMeta } from "@/server/types";

// Compare two ISO timestamp strings, newest first. Plain string compare is
// chronological for identical ISO-8601 formatting.
function newerFirst(a: string, b: string): number {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

/**
 * Order a project group's sessions: cluster by ticket, newest-first within each
 * cluster and across clusters. Equal createdAt tie-breaks by id, descending.
 * Returns a new array; does not mutate the input.
 */
export function orderSessions(items: SessionMeta[]): SessionMeta[] {
  const clusters = new Map<string, SessionMeta[]>();
  for (const s of items) {
    const arr = clusters.get(s.ticket);
    if (arr) arr.push(s);
    else clusters.set(s.ticket, [s]);
  }

  const bySessionDesc = (a: SessionMeta, b: SessionMeta) =>
    newerFirst(a.createdAt, b.createdAt) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  const ordered = [...clusters.entries()].map(([ticket, arr]) => {
    const sorted = [...arr].sort(bySessionDesc);
    return { ticket, sorted, newest: sorted[0].createdAt }; // sorted[0] is newest
  });

  ordered.sort(
    (a, b) =>
      newerFirst(a.newest, b.newest) ||
      (a.ticket < b.ticket ? 1 : a.ticket > b.ticket ? -1 : 0),
  );

  return ordered.flatMap((c) => c.sorted);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/orderSessions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/orderSessions.ts tests/lib/orderSessions.test.ts
git commit -m "feat(mojito): add orderSessions helper (RIC-108)"
```

---

### Task 2: Wire `orderSessions` into `SessionList`

**Files:**
- Modify: `src/components/SessionList.tsx` (add import near line 6; wrap the group render at line 61)

**Interfaces:**
- Consumes: `orderSessions` from `@/lib/orderSessions` (Task 1).
- Produces: nothing new — internal render change only.

- [ ] **Step 1: Add the import**

In `src/components/SessionList.tsx`, after the existing type import (line 6):

```ts
import { orderSessions } from "@/lib/orderSessions";
```

- [ ] **Step 2: Order each group's sessions in the render**

Change the group body (currently `{items.map((s) => {`) at line 61 to order first:

```tsx
{orderSessions(items).map((s) => {
```

Leave everything inside the `.map(...)` callback and the rest of the component unchanged.

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (including Task 1's).

- [ ] **Step 4: Manually verify in the app**

Run the app (`npm run dev`), open the session list with multiple sessions across at
least two tickets in one project. Confirm: sessions of the same ticket are adjacent;
newest session appears first within each ticket; the ticket whose newest session is most
recent appears first; project headers and cards are otherwise unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/SessionList.tsx
git commit -m "feat(mojito): order session list by ticket, newest-first (RIC-108)"
```

---

## Self-Review

- **Spec coverage:** project grouping preserved (Task 2 keeps the `groups` reduce and headers) ✓; cluster by ticket (Task 1 Map) ✓; newest-first within cluster (bySessionDesc) ✓; clusters ordered by newest session (ordered.sort on `newest`) ✓; adjacency only, no new header (Task 2 wraps only `items.map`) ✓; deterministic tie-break by id ✓; no backend/timestamp change ✓.
- **Placeholder scan:** none — all steps have concrete code and commands.
- **Type consistency:** `orderSessions(items: SessionMeta[]): SessionMeta[]` used identically in Task 1 (definition) and Task 2 (call site); reads only `id`, `ticket`, `createdAt`, all present on `SessionMeta`.
