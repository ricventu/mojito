# Persist filter & search state Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the active tab and each list's project filter + search text so they survive in-app navigation and page reloads.

**Architecture:** A pure `readPersisted` helper (unit-tested) plus a thin `usePersistedState` hook that mirrors a string value into `localStorage`, used as a drop-in `useState` replacement in `page.tsx`, `TicketList`, and `SessionList`. Mirrors the existing `useToken` → `resolveInitialToken` split.

**Tech Stack:** Next.js (client components), TypeScript, React `useState`, vitest (node environment).

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Test command: `npx tsc --noEmit && npx vitest run` — must stay green (baseline: 150 passing).
- vitest environment is **node** — no DOM, no testing-library; do not render hooks in tests. Test pure functions only.
- localStorage keys use the `mojito-` prefix (existing convention: `mojito-token`).
- Follow existing file conventions; keep files small and single-purpose.

---

### Task 1: `usePersistedState` hook + `readPersisted` helper

**Files:**
- Create: `src/lib/usePersistedState.ts`
- Test: `tests/lib/usePersistedState.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `readPersisted(storage: Pick<Storage, "getItem"> | undefined, key: string, fallback: string): string`
  - `usePersistedState(key: string, initial: string): [string, (v: string) => void]`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/usePersistedState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readPersisted } from "@/lib/usePersistedState";

describe("readPersisted", () => {
  it("returns the stored value when the key is present", () => {
    const storage = { getItem: (k: string) => (k === "mojito-tab" ? "sessions" : null) };
    expect(readPersisted(storage, "mojito-tab", "tickets")).toBe("sessions");
  });

  it("falls back to the initial value when the key is absent", () => {
    const storage = { getItem: () => null };
    expect(readPersisted(storage, "mojito-tab", "tickets")).toBe("tickets");
  });

  it("falls back to the initial value when storage is undefined (SSR guard)", () => {
    expect(readPersisted(undefined, "mojito-tab", "tickets")).toBe("tickets");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/usePersistedState.test.ts`
Expected: FAIL — cannot resolve `@/lib/usePersistedState` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/usePersistedState.ts`:

```ts
"use client";
import { useState } from "react";

// Pure, testable: returns the stored string, or the fallback when the key is
// absent or storage is unavailable (SSR / no window).
export function readPersisted(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
  fallback: string,
): string {
  return storage?.getItem(key) ?? fallback;
}

// Drop-in useState replacement that mirrors a string value into localStorage.
// String-valued only (callers store a tab id, a search string, or a project
// sentinel), so no JSON serialization is needed.
export function usePersistedState(
  key: string,
  initial: string,
): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() =>
    readPersisted(typeof window === "undefined" ? undefined : window.localStorage, key, initial),
  );
  const set = (v: string) => {
    setValue(v);
    if (typeof window !== "undefined") window.localStorage.setItem(key, v);
  };
  return [value, set];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/usePersistedState.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/usePersistedState.ts tests/lib/usePersistedState.test.ts
git commit -m "feat(mojito): add usePersistedState localStorage hook (RIC-109)"
```

---

### Task 2: Persist the active tab in `page.tsx`

**Files:**
- Modify: `src/app/page.tsx:22`

**Interfaces:**
- Consumes: `usePersistedState` from Task 1.
- Produces: nothing (leaf wiring).

- [ ] **Step 1: Add the import**

In `src/app/page.tsx`, add after the existing `useToken` import (line 4):

```ts
import { usePersistedState } from "@/lib/usePersistedState";
```

- [ ] **Step 2: Replace the `tab` state**

Replace line 22:

```ts
  const [tab, setTab] = useState<"tickets" | "sessions">("tickets");
```

with:

```ts
  const [tab, setTab] = usePersistedState("mojito-tab", "tickets");
```

`tab` is now typed `string`; every use is a comparison against `"tickets"` / `"sessions"` or a `setTab("tickets"|"sessions")` literal call, so no other edits are needed. Leave the `useState` import in place — it is still used for `open` and `alerts`.

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`; all tests pass (150 baseline + 3 new = 153). No new automated test — node environment cannot render the page; the typecheck plus the unchanged regression suite is the gate.

- [ ] **Step 4: Manual smoke check**

Run `npm run dev`, open the app, switch to the **Sessions** tab, reload the page. Expected: the app reopens on **Sessions**, not Tickets.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(mojito): persist active tab across reloads (RIC-109)"
```

---

### Task 3: Persist Tickets & Sessions filters (query + project)

**Files:**
- Modify: `src/components/TicketList.tsx:13-14`
- Modify: `src/components/SessionList.tsx:14-15`

**Interfaces:**
- Consumes: `usePersistedState` from Task 1.
- Produces: nothing (leaf wiring).

The project chip models "All" as `project === null`; the hook stores strings, so each
list maps at its boundary — `""` in storage means `null` ("All"). Keeping the local
names `project` / `setProject` means the `FilterBar` props and the filter predicate
below them need no changes.

- [ ] **Step 1: Wire `TicketList`**

In `src/components/TicketList.tsx`, add the import after the `FilterBar` import (line 4):

```ts
import { usePersistedState } from "@/lib/usePersistedState";
```

Replace lines 13-14:

```ts
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
```

with:

```ts
  const [query, setQuery] = usePersistedState("mojito-tickets-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-tickets-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
```

Leave the `useState` import — it is still used for `picked` (line 12).

- [ ] **Step 2: Wire `SessionList`**

In `src/components/SessionList.tsx`, add the import after the `NewSessionSheet` import (line 6):

```ts
import { usePersistedState } from "@/lib/usePersistedState";
```

Replace lines 14-15:

```ts
  const [query, setQuery] = useState("");
  const [project, setProject] = useState<string | null>(null);
```

with:

```ts
  const [query, setQuery] = usePersistedState("mojito-sessions-q", "");
  const [projectRaw, setProjectRaw] = usePersistedState("mojito-sessions-project", "");
  const project = projectRaw === "" ? null : projectRaw;
  const setProject = (p: string | null) => setProjectRaw(p ?? "");
```

Leave line 16 (`const [newOpen, setNewOpen] = useState(false);`) unchanged, and leave the `useState` import — it is still used for `newOpen`.

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`; all tests pass (153). No new automated test — the wiring is mechanical; typecheck + regression suite is the gate.

- [ ] **Step 4: Manual smoke check**

Run `npm run dev`. On **Tickets**: type a search term and pick a project chip. Open a ticket's session, then go **Back** → the search text and chip are still applied. Reload the page → still applied. Repeat on the **Sessions** tab. Clear the search and click **All** → reload → returns to the empty/All state (the cleared state persists too).

- [ ] **Step 5: Commit**

```bash
git add src/components/TicketList.tsx src/components/SessionList.tsx
git commit -m "feat(mojito): persist ticket & session filters and search (RIC-109)"
```

---

## Self-Review

**Spec coverage:**
- Persist active tab → Task 2. ✓
- Persist Tickets query + project → Task 3 (Step 1). ✓
- Persist Sessions query + project → Task 3 (Step 2). ✓
- Independent per-list filters → distinct keys `mojito-tickets-*` / `mojito-sessions-*`. ✓
- Survive in-app navigation + reload → localStorage-backed; verified in Task 2 Step 4 and Task 3 Step 4. ✓
- Project sentinel (`""` means `null`) → Task 3 boundary mapping. ✓
- Hydration-safe / no flash → consumers render only behind the client-side token gate (spec rationale); no server HTML carries these values. ✓
- Stale saved project → accepted "No matching…" behavior, no coercion (spec non-goal); nothing to implement. ✓
- Testing on pure `readPersisted` in node env → Task 1. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows complete code. ✓

**Type consistency:** `readPersisted` and `usePersistedState` signatures identical across Tasks 1–3; `project: string | null` and `setProject: (p: string | null) => void` match the `FilterBar` props (`active`, `onProject`) they feed. ✓
