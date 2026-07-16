# Browser Tab Title While a Ticket Terminal Is Open — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set the browser tab title to `<ticket-id> — <ticket-title>` while a ticket's terminal is open, and restore the previous title when it closes.

**Architecture:** A pure formatter `terminalTabTitle(session)` in `src/lib/` builds the string; a `useEffect` in `TerminalView` (which renders only while a terminal is open) sets `document.title` on mount and restores the captured previous value on unmount, mirroring the component's existing overflow save/restore effect.

**Tech Stack:** Next.js (App Router, client component), TypeScript, React `useEffect`, Vitest.

## Global Constraints

- All code identifiers, comments, and commit messages in English (project rule). The literal tab-title string `"Mojito"` fallback and the em-dash separator are intentional and stay as written.
- Format separator is an em dash `—` (U+2014) with a single space on each side: `${id} — ${title}`.
- Test command: `npm test` (alias for `vitest run`). Typecheck: `npm run typecheck` (`tsc --noEmit`).
- **Dependencies are not yet installed in this worktree.** Run `npm install` once before the first test/typecheck step.
- Pure helpers live in `src/lib/`; their tests live in `tests/lib/` (repo convention, e.g. `orderTickets.ts` → `tests/lib/orderTickets.test.ts`).
- `SessionMeta.title` may be `undefined` at runtime on sidecars persisted before the field existed (documented on the type); the formatter must guard/trim both `ticket` and `title`.

---

### Task 1: Pure `terminalTabTitle` formatter

**Files:**
- Create: `src/lib/terminalTabTitle.ts`
- Test: `tests/lib/terminalTabTitle.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` from `src/server/types.ts` (fields `ticket: string`, `title: string`; both may be empty/undefined at runtime).
- Produces: `terminalTabTitle(session: SessionMeta): string` — returns `"${id} — ${title}"` when both present; the id alone when only the id is present; the title alone when only the title is present; `"Mojito"` when neither.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/terminalTabTitle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { terminalTabTitle } from "@/lib/terminalTabTitle";
import type { SessionMeta } from "@/server/types";

// Minimal SessionMeta factory — only the fields the formatter reads matter;
// the rest are filled with valid-but-irrelevant defaults.
function session(over: Partial<SessionMeta>): SessionMeta {
  return {
    kind: "lime",
    id: "mojito-RIC-129-todo",
    ticket: "RIC-129",
    launchStatus: "Todo",
    model: "opus",
    effort: "high",
    autoAdvance: false,
    state: "running",
    cwd: "/tmp",
    createdAt: "2026-07-16T00:00:00.000Z",
    title: "title browser con ticket",
    labels: [],
    ...over,
  };
}

describe("terminalTabTitle", () => {
  it("combines id and title with an em dash", () => {
    expect(terminalTabTitle(session({}))).toBe("RIC-129 — title browser con ticket");
  });

  it("falls back to the id alone when the title is missing", () => {
    // Cast: title is typed non-optional but can be undefined on old sidecars.
    expect(terminalTabTitle(session({ title: undefined as unknown as string }))).toBe("RIC-129");
    expect(terminalTabTitle(session({ title: "   " }))).toBe("RIC-129");
  });

  it("falls back to the title alone when there is no ticket id", () => {
    expect(terminalTabTitle(session({ ticket: "" }))).toBe("title browser con ticket");
  });

  it("falls back to Mojito for a custom session with no id and no title", () => {
    expect(terminalTabTitle(session({ ticket: "", title: "" }))).toBe("Mojito");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm install` (first time only), then `npm test -- terminalTabTitle`
Expected: FAIL — cannot resolve `@/lib/terminalTabTitle` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/terminalTabTitle.ts`:

```ts
import type { SessionMeta } from "@/server/types";

// Browser tab title for an open ticket terminal. `ticket`/`title` can be empty
// (custom sessions) or `title` undefined (sidecars from before the field existed),
// so both are trimmed and guarded.
export function terminalTabTitle(session: SessionMeta): string {
  const id = session.ticket?.trim();
  const title = session.title?.trim();
  if (id && title) return `${id} — ${title}`;
  if (id) return id;
  if (title) return title;
  return "Mojito";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- terminalTabTitle`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/terminalTabTitle.ts tests/lib/terminalTabTitle.test.ts
git commit -m "feat(mojito): terminalTabTitle formatter for the browser tab (RIC-129)"
```

---

### Task 2: Set `document.title` from `TerminalView`

**Files:**
- Modify: `src/components/TerminalView.tsx` (add one `useEffect`; add the import)

**Interfaces:**
- Consumes: `terminalTabTitle` from Task 1; `session: SessionMeta` (already a prop).
- Produces: no new exports — a side effect on `document.title` scoped to the terminal's open/closed lifecycle.

- [ ] **Step 1: Add the import**

At the top of `src/components/TerminalView.tsx`, alongside the other imports, add:

```ts
import { terminalTabTitle } from "@/lib/terminalTabTitle";
```

- [ ] **Step 2: Add the `document.title` effect**

Insert a new `useEffect` immediately after the existing overflow save/restore effect
(the one that ends by restoring `html.style.overflow` etc., currently ~line 185),
so the two DOM-side-effect blocks sit together:

```ts
  // Reflect the open ticket in the browser tab title, then restore the previous
  // title when the terminal closes. Mirrors the overflow save/restore effect above.
  useEffect(() => {
    const prev = document.title;
    document.title = terminalTabTitle(session);
    return () => {
      document.title = prev;
    };
  }, [session.ticket, session.title]);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Run the full test suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — all existing suites plus the new `terminalTabTitle` tests; 0 failures.
(The tmux integration test may be skipped if `tmux` is unavailable — that is expected.)

- [ ] **Step 5: Manual verification**

Start the app in this worktree on a non-default port (the memory note: the main
checkout's dev server on :8700 shares `.next` — do not run a server from the main
checkout; use a different port here), open a ticket terminal, and confirm the browser
tab reads `<ID> — <title>` (e.g. `RIC-129 — title browser con ticket`). Go back to the
list and confirm the tab title returns to `Mojito`.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "feat(mojito): set browser tab title to the open ticket (RIC-129)"
```

---

## Self-Review

**Spec coverage:**
- "Set `document.title` to `<ID> — <title>` while `TerminalView` is mounted" → Task 2 effect. ✓
- "Restore the previous title when it closes" → Task 2 effect cleanup. ✓
- Format `<ID> — <title>` (em dash, id first, no suffix) → Task 1 formatter + test. ✓
- Edge cases (missing title → id only; custom session → `Mojito`) → Task 1 behaviour table + tests. ✓
- Testing: pure formatter unit-tested under `tests/lib/`; effect left as a thin untested wrapper → Tasks 1–2. ✓
- Out-of-scope items (layout metadata, list views, per-state titles) → not touched. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" placeholders; every code step shows full code. ✓

**Type consistency:** `terminalTabTitle(session: SessionMeta): string` is defined in Task 1 and consumed with that exact signature in Task 2. `SessionMeta` fields used (`ticket`, `title`) match `src/server/types.ts`. ✓
