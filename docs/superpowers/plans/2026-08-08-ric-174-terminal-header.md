# RIC-174 Terminal Header Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the terminal view's two-block chrome into one header row that never overflows horizontally, so every control stays reachable on a phone.

**Architecture:** The header becomes three flex zones — a fixed back button, a flexible identity block (`flex: 1; min-width: 0`) that absorbs all truncation, and a fixed action cluster that can never be pushed off-screen. The "which identity fields exist" branching moves out of JSX into a pure, unit-tested presenter in `src/lib/`. Narrow-width adaptations are CSS media queries over markup that renders both forms, so no JS breakpoint state has to stay in sync with the existing fit/keyboard machinery.

**Tech Stack:** Next.js 15, React 19, TypeScript, plain CSS in `src/app/globals.css` (design tokens, no CSS modules), vitest in the `node` environment.

**Spec:** `docs/superpowers/specs/2026-08-08-terminal-header-refactor-design.md`

## Global Constraints

- All code artifacts in English — identifiers, comments, commit messages.
- No new dependencies. `package.json` must not change.
- Tests are `tests/**/*.test.ts` only. vitest runs `environment: "node"` and there is no React testing library — do not attempt to render components in a test. Push logic into `src/lib/*.ts` and test that.
- Import from `src/` via the `@/` alias (`@/lib/…`, `@/server/…`), matching every existing file.
- Styling uses the existing CSS custom properties in `:root` (`--surface`, `--border`, `--text-dim`, `--mono`, …). Do not introduce raw hex colours.
- The chrome must keep hiding while the virtual keyboard is open — the `!kbdOpen &&` guard around the header stays exactly as it is. Do not touch the fit, resize, viewport-settle, or WebSocket code in `TerminalView.tsx`.
- Baseline to preserve: `npx tsc --noEmit && npx vitest run` → 593 tests passing.

---

### Task 1: Pure header presenter

Extract the identity/kill-button branching out of the component into a tested unit.

**Files:**
- Create: `src/lib/terminalHeader.ts`
- Test: `tests/lib/terminalHeader.test.ts`

**Interfaces:**
- Consumes: `SessionMeta` and `SessionState` from `@/server/types`.
- Produces:
  - `interface TerminalHeadModel { id: string; status: string; title: string; name: string; killLabel: string; killDanger: boolean }`
  - `function isActiveSession(state: SessionState): boolean`
  - `function terminalHeadModel(session: SessionMeta): TerminalHeadModel`

  Task 2 renders exactly these fields. Empty string means "render nothing".

- [ ] **Step 1: Write the failing test**

Create `tests/lib/terminalHeader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { terminalHeadModel, isActiveSession } from "@/lib/terminalHeader";
import type { SessionMeta, SessionState } from "@/server/types";

const base: SessionMeta = {
  kind: "ticket",
  id: "mojito-RIC-174-work",
  ticket: "RIC-174",
  launchStatus: "In Progress",
  model: "opus",
  effort: "high",
  state: "running",
  cwd: "/home/mojito/code/mojito",
  createdAt: "2026-08-08T10:00:00.000Z",
  title: "Refactor header terminale",
  labels: [],
};

describe("terminalHeadModel", () => {
  it("carries every identity field of a ticket session", () => {
    expect(terminalHeadModel(base)).toEqual({
      id: "RIC-174",
      status: "In Progress",
      title: "Refactor header terminale",
      name: "RIC-174",
      killLabel: "Kill",
      killDanger: true,
    });
  });

  it("blanks id and status for a custom session, keeping the title", () => {
    const m = terminalHeadModel({ ...base, kind: "custom", ticket: "", launchStatus: "" });
    expect(m.id).toBe("");
    expect(m.status).toBe("");
    expect(m.title).toBe("Refactor header terminale");
  });

  it("falls back to the title when there is no ticket id", () => {
    const m = terminalHeadModel({ ...base, ticket: "", title: "scratch shell" });
    expect(m.name).toBe("scratch shell");
  });

  it("names a bare shell session generically", () => {
    const m = terminalHeadModel({ ...base, kind: "shell", ticket: "", launchStatus: "", title: "" });
    expect(m).toEqual({
      id: "", status: "", title: "", name: "this session",
      killLabel: "Kill", killDanger: true,
    });
  });

  it("tolerates a legacy sidecar with no title field", () => {
    const legacy = { ...base } as Partial<SessionMeta>;
    delete legacy.title;
    const m = terminalHeadModel(legacy as SessionMeta);
    expect(m.title).toBe("");
    expect(m.name).toBe("RIC-174");
  });

  it("trims whitespace-only fields to empty", () => {
    const m = terminalHeadModel({ ...base, ticket: "  ", launchStatus: "\t", title: "  " });
    expect(m).toMatchObject({ id: "", status: "", title: "", name: "this session" });
  });

  it("trims padding around real values", () => {
    const m = terminalHeadModel({ ...base, ticket: " RIC-9 ", title: " padded " });
    expect(m.id).toBe("RIC-9");
    expect(m.title).toBe("padded");
  });
});

describe("kill button per state", () => {
  const expected: Record<SessionState, { killLabel: string; killDanger: boolean }> = {
    starting: { killLabel: "Kill", killDanger: true },
    running: { killLabel: "Kill", killDanger: true },
    idle: { killLabel: "Kill", killDanger: true },
    "needs-input": { killLabel: "Kill", killDanger: true },
    done: { killLabel: "Dismiss", killDanger: false },
    failed: { killLabel: "Dismiss", killDanger: false },
  };

  for (const [state, want] of Object.entries(expected) as [SessionState, typeof expected[SessionState]][]) {
    it(`labels a ${state} session "${want.killLabel}"`, () => {
      expect(terminalHeadModel({ ...base, state })).toMatchObject(want);
      expect(isActiveSession(state)).toBe(want.killDanger);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/terminalHeader.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/terminalHeader"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/terminalHeader.ts`:

```ts
import type { SessionMeta, SessionState } from "@/server/types";

/**
 * What the terminal header renders.
 *
 * The identity zone has to cope with sessions carrying very different amounts of
 * metadata: a ticket session has id, status and title; a custom session has only
 * a title; a shell session may have none of them; and sidecars written before
 * `title` existed can leave it `undefined` at runtime despite the type (see
 * SessionMeta). Every field is normalised to a string here so the component can
 * branch on emptiness alone.
 */
export interface TerminalHeadModel {
  id: string;         // "RIC-174", or "" when the session has no ticket
  status: string;     // Linear status at launch, or "" for custom/shell sessions
  title: string;      // Linear ticket title, or "" when unknown
  name: string;       // best human label for the kill confirm: id, else title, else a generic
  killLabel: string;  // "Kill" while the session can still be interrupted, else "Dismiss"
  killDanger: boolean;
}

/**
 * Can this session still be interrupted? "done" and "failed" ones are inert —
 * the button then only dismisses a leftover card, so it is not styled as
 * destructive.
 */
const ACTIVE: ReadonlySet<SessionState> = new Set<SessionState>([
  "starting",
  "running",
  "needs-input",
  "idle",
]);

export function isActiveSession(state: SessionState): boolean {
  return ACTIVE.has(state);
}

export function terminalHeadModel(session: SessionMeta): TerminalHeadModel {
  const id = session.ticket?.trim() ?? "";
  const title = session.title?.trim() ?? "";
  const active = isActiveSession(session.state);
  return {
    id,
    status: session.launchStatus?.trim() ?? "",
    title,
    name: id || title || "this session",
    killLabel: active ? "Kill" : "Dismiss",
    killDanger: active,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/terminalHeader.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/terminalHeader.ts tests/lib/terminalHeader.test.ts
git commit -m "feat(terminal): pure presenter for the header identity zone"
```

---

### Task 2: One-row header

Rebuild the header markup and its CSS around the three zones, and delete the separate title block.

**Files:**
- Modify: `src/components/StateBadge.tsx` (whole file, 15 lines)
- Modify: `src/components/TerminalView.tsx:347-372` (the `active`/`kill` pair and the JSX header)
- Modify: `src/app/globals.css:255-261` (the `.term-head` / `.term-title` rules)

**Interfaces:**
- Consumes: `terminalHeadModel` and `isActiveSession` from `@/lib/terminalHeader` (Task 1).
- Produces: no new exports. `StateBadge`'s rendered label gains a `.lbl` wrapper so CSS can hide it; its props are unchanged.

- [ ] **Step 1: Wrap the StateBadge label so CSS can hide it**

The label is currently a bare text node, which CSS cannot target. Replace the
return in `src/components/StateBadge.tsx`:

```tsx
export default function StateBadge({ state }: { state: SessionState }) {
  const b = BADGE[state];
  return (
    <span className={`badge ${b.cls}`}>
      <span className="dot" />
      <span className="lbl">{b.label}</span>
    </span>
  );
}
```

This is visually a no-op: `.badge` is `display: inline-flex`, and a bare text
node in a flex container already becomes an anonymous flex item subject to the
same `gap`. `SessionList` keeps rendering identically.

- [ ] **Step 2: Import the presenter in TerminalView**

In `src/components/TerminalView.tsx`, add to the import block (after the
`terminalTabTitle` import on line 17):

```tsx
import { terminalHeadModel, isActiveSession } from "@/lib/terminalHeader";
```

- [ ] **Step 3: Replace the inline `active` derivation with the presenter**

Replace lines 347-355 (`const active = …` through the end of `kill`):

```tsx
  const head = terminalHeadModel(session);
  const active = isActiveSession(session.state);
  const kill = async () => {
    const prompt = active
      ? `Kill the running session for ${head.name}?`
      : `Dismiss the session for ${head.name}?`;
    if (!confirm(prompt)) return;
    await apiFetch(token, `/api/sessions/${session.id}`, { method: "DELETE" });
    onBack();
  };
```

`head.name` replaces the raw `session.ticket`, which rendered as
"Kill the running session for ?" on custom and shell sessions.

- [ ] **Step 4: Replace the header JSX**

Replace the `<header className="term-head">…</header>` block and the
`.term-title` line that follows it (lines 359-372) with:

```tsx
      {!kbdOpen && (
      <header className="term-head">
        <button className="back" aria-label="Back" onClick={onBack}>‹</button>
        <div className="term-ident">
          {head.id && <span className="id">{head.id}</span>}
          {head.status && <span className="status">· {head.status}</span>}
          {head.title && <span className="title">{head.title}</span>}
        </div>
        <div className="term-actions">
          <button className="btn sm" aria-label="Documents" title="Documents" onClick={() => setDocsOpen(true)}>📄</button>
          <StateBadge state={session.state} />
          <button
            className={`btn sm kill${head.killDanger ? " danger" : ""}`}
            aria-label={head.killLabel}
            title={head.killLabel}
            onClick={kill}
          >
            <span className="lbl">{head.killLabel}</span>
            <span className="glyph" aria-hidden="true">✕</span>
          </button>
        </div>
      </header>
      )}
```

The `.grow` spacer is gone — `.term-ident` is the flexible zone now. The
separate `{session.title && !kbdOpen && <div className="term-title">…}` line is
deleted; the title lives inside the identity zone.

- [ ] **Step 5: Replace the header CSS**

In `src/app/globals.css`, replace the four `.term-head` rules and the
`.term-title` rule (lines 255-261) with:

```css
/* Three zones: a fixed back button, a flexible identity block that absorbs all
   truncation, and a fixed action cluster.

   `min-width: 0` on the identity zone is the whole fix. Flex items default to
   `min-width: auto` and refuse to shrink below their content, so the ticket id,
   the status name and the title used to push the action cluster past the right
   edge — and `.term-root` is position:fixed with body overflow hidden, so the
   overflow could not be scrolled back into view. The Kill button was simply
   unreachable on a phone. Keeping the actions `flex: none` and letting the
   identity zone give way means the row can never overflow. */
.term-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
  border-bottom: 1px solid var(--border); background: var(--surface); }
.term-head .back { width: 32px; height: 32px; border-radius: 8px; background: var(--surface-hi);
  border: 1px solid var(--border-hi); color: var(--text); font-size: 18px; cursor: pointer; flex: none; }

.term-ident { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.term-ident .id { flex: none; font: 700 13px var(--mono); color: var(--text); letter-spacing: -.01em; }
.term-ident .status { flex: none; font: 500 12px var(--mono); color: var(--text-dim); white-space: nowrap; }
.term-ident .title { flex: 1; min-width: 0; font: 500 13px/1.3 var(--mono); color: var(--text-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.term-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.term-actions .btn.sm { flex: none; }
.term-head .kill .glyph { display: none; }

/* Phone: shed the labels whose meaning is already carried by colour, or by the
   card the user tapped to get here, so the title keeps as much width as it can. */
@media (max-width: 480px) {
  .term-ident .status { display: none; }
  .term-head .badge { padding: 5px; gap: 0; }
  .term-head .badge .lbl { display: none; }
  .term-head .kill .lbl { display: none; }
  .term-head .kill .glyph { display: inline; }
  .term-head .kill { padding: 7px 10px; font-size: 13px; line-height: 1; }
}
```

- [ ] **Step 6: Verify no stale references to the deleted block**

Run: `grep -rn "term-title\|\.grow" src/components/TerminalView.tsx src/app/globals.css`
Expected: no `term-title` hit anywhere; `.grow` still defined in `globals.css:98`
(other views use it) but absent from `TerminalView.tsx`.

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no tsc output; 71 files, 606 tests passing (593 baseline + 13 from Task 1).

- [ ] **Step 8: Commit**

```bash
git add src/components/TerminalView.tsx src/components/StateBadge.tsx src/app/globals.css
git commit -m "feat(terminal): one-row header that never overflows on mobile"
```

---

## Verification

Whole-branch check before review:

```bash
npx tsc --noEmit && npx vitest run
git diff main...HEAD --stat
```

The layout itself is CSS and has no automated coverage — consistent with every
other view in this repo. Read the diff against the spec's two rendered forms:
at ≤480px the row is back · id · truncated title · dot · 📄 · ✕, and at wider
widths it expands to back · id · status · truncated title · full badge · 📄 ·
Kill.
