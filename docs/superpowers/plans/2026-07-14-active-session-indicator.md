# Active-session Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a colored dot on each ticket card when that ticket has at least one active lime session, colored by the most urgent active state.

**Architecture:** A pure helper (`activeSessionLevel`) computes a ticket's active-session level from the `sessions` array already passed into `TicketList`; the component renders a presentational dot via a memoized lookup. Mirrors the existing `orderSessions` helper + colocated test pattern. No API, type, or data-flow change.

**Tech Stack:** Next.js, React, TypeScript, Vitest.

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- **Active** = session `state` of `starting`, `running`, or `needs-input`. `done`/`failed` are NOT active.
- Urgency: `needs-input` (`"attn"`) outranks `running`/`starting` (`"run"`).
- Matching is per-ticket: only sessions with `s.ticket === ticket` count.
- Full-suite gate for any task touching TS: `npx tsc --noEmit && npx vitest run`.
- Work happens in the worktree at `.worktrees/ricventu/ric-116-indicatore-sessioni-attive`; confirm `git branch --show-current` is `ricventu/ric-116-indicatore-sessioni-attive` before committing.

---

### Task 1: `activeSessionLevel` helper

**Files:**
- Create: `src/lib/ticketSessionLevel.ts`
- Test: `tests/lib/ticketSessionLevel.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` from `@/server/types` (fields `ticket: string`, `state: SessionState`).
- Produces:
  ```ts
  export type ActiveLevel = "attn" | "run";
  export function activeSessionLevel(ticket: string, sessions: SessionMeta[]): ActiveLevel | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ticketSessionLevel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeSessionLevel } from "@/lib/ticketSessionLevel";
import type { SessionMeta, SessionState } from "@/server/types";

// minimal SessionMeta factory — only ticket and state matter here
function s(ticket: string, state: SessionState): SessionMeta {
  return {
    id: `${ticket}-${state}`, ticket, state,
    launchStatus: "", model: "", effort: "low", autoAdvance: false,
    cwd: "", createdAt: "2026-07-14T10:00:00.000Z", title: "", labels: [],
  } as SessionMeta;
}

describe("activeSessionLevel", () => {
  it("returns null when there are no sessions", () => {
    expect(activeSessionLevel("RIC-1", [])).toBeNull();
  });

  it("returns null when only done/failed sessions exist for the ticket", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "done"), s("RIC-1", "failed")])).toBeNull();
  });

  it("returns 'run' for a running or starting session", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "running")])).toBe("run");
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "starting")])).toBe("run");
  });

  it("returns 'attn' for a needs-input session", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "needs-input")])).toBe("attn");
  });

  it("prioritizes needs-input over running", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "running"), s("RIC-1", "needs-input")])).toBe("attn");
  });

  it("only counts sessions for the given ticket", () => {
    const sessions = [s("RIC-2", "needs-input"), s("RIC-1", "running")];
    expect(activeSessionLevel("RIC-1", sessions)).toBe("run");
  });

  it("returns null when all active sessions belong to other tickets", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-2", "running")])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ticketSessionLevel.test.ts`
Expected: FAIL — cannot resolve `@/lib/ticketSessionLevel` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/ticketSessionLevel.ts`:

```ts
import type { SessionMeta } from "@/server/types";

export type ActiveLevel = "attn" | "run";

/**
 * The active-session level for a ticket, or null when it has none.
 * "attn" (needs input) outranks "run" (running/starting). done/failed are ignored.
 * Only sessions whose `ticket` matches are considered.
 */
export function activeSessionLevel(
  ticket: string,
  sessions: SessionMeta[],
): ActiveLevel | null {
  let level: ActiveLevel | null = null;
  for (const ssn of sessions) {
    if (ssn.ticket !== ticket) continue;
    if (ssn.state === "needs-input") return "attn"; // highest priority — done early
    if (ssn.state === "running" || ssn.state === "starting") level = "run";
  }
  return level;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ticketSessionLevel.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ticketSessionLevel.ts tests/lib/ticketSessionLevel.test.ts
git commit -m "feat(mojito): add activeSessionLevel helper (RIC-116)"
```

---

### Task 2: Render the dot in `TicketList` + styling

**Files:**
- Modify: `src/components/TicketList.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `activeSessionLevel` and `ActiveLevel` from `@/lib/ticketSessionLevel` (Task 1); the `sessions: SessionMeta[]` prop `TicketList` already receives.
- Produces: no exported API; a rendered `<span className="s-dot run|attn">` on ticket cards.

- [ ] **Step 1: Add the CSS for the dot**

In `src/app/globals.css`, after the state-badge block (the `.badge` rules near line 128+), add:

```css
/* ---- Active-session dot (ticket cards) ---- */
.s-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  margin-left: 6px;
  vertical-align: middle;
}
.s-dot.run  { background: var(--run); }
.s-dot.attn {
  background: var(--attn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--attn) 25%, transparent);
}
```

- [ ] **Step 2: Build the level lookup and render the dot in `TicketList`**

In `src/components/TicketList.tsx`:

1. Add the import near the existing imports (top of file):

```tsx
import { activeSessionLevel, type ActiveLevel } from "@/lib/ticketSessionLevel";
```

2. Inside the component, after the `projects` `useMemo` (around line 18), add a memoized lookup:

```tsx
  const levels = useMemo(() => {
    const m = new Map<string, ActiveLevel>();
    for (const t of tickets) {
      const level = activeSessionLevel(t.identifier, sessions);
      if (level) m.set(t.identifier, level);
    }
    return m;
  }, [tickets, sessions]);
```

3. In the ticket card, add the dot to the header row. Replace this block:

```tsx
              <div><span className="id">{t.identifier}</span> <span className="status">· {t.statusName}</span></div>
```

with:

```tsx
              <div>
                <span className="id">{t.identifier}</span> <span className="status">· {t.statusName}</span>
                {levels.get(t.identifier) && (
                  <span
                    className={`s-dot ${levels.get(t.identifier)}`}
                    aria-label={levels.get(t.identifier) === "attn" ? "needs input" : "session running"}
                    title={levels.get(t.identifier) === "attn" ? "needs input" : "session running"}
                  />
                )}
              </div>
```

- [ ] **Step 3: Verify types and the full suite pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `No errors found`; all tests pass (baseline 76 + 7 new from Task 1 = 83), 0 failures.

- [ ] **Step 4: Manual visual verification**

Run the app (`npm run dev`), open the Tickets tab, and confirm:
- A ticket with a running session shows a green dot; launching a session makes the dot appear without a manual refresh (WebSocket-driven).
- When that session transitions to needs-input, the dot turns amber (with glow).
- When the session finishes (done) or fails, the dot disappears.
- A ticket with no session shows no dot.

Note in the commit/PR if a live session was not available to exercise all transitions manually; the helper's unit tests cover the state logic regardless.

- [ ] **Step 5: Commit**

```bash
git add src/components/TicketList.tsx src/app/globals.css
git commit -m "feat(mojito): show active-session dot on ticket cards (RIC-116)"
```

---

## Self-Review

**Spec coverage:**
- Helper `ticketSessionLevel.ts` with the exact signature → Task 1. ✓
- Active-only definition + `needs-input` priority → Task 1 logic + tests. ✓
- Memoized `ticket → level` lookup + dot on card header, none when null → Task 2 Step 2. ✓
- `.s-dot` styling reusing `--run`/`--attn` tokens → Task 2 Step 1. ✓
- Accessibility (`aria-label`/`title`, not color-only) → Task 2 Step 2. ✓
- Live update via existing WebSocket flow → Task 2 Step 4 manual check (no code change needed). ✓
- Test cases enumerated in spec → Task 1 Step 1. ✓
- Out of scope (no type/API/lime-contract change) → respected; only 4 files touched. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `ActiveLevel = "attn" | "run"` and `activeSessionLevel(ticket, sessions)` used identically in Task 1 (definition) and Task 2 (import + call). `SessionState` values match `src/server/types.ts`. ✓
