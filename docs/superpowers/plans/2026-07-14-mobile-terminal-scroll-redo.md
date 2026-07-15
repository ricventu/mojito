# Mobile Terminal Scroll (redo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make touch-dragging inside the terminal scroll the terminal scrollback (not the whole page) on mobile Safari / iPhone 11 (RIC-107), after the first fix shipped but failed on the device.

**Architecture:** Own the vertical drag gesture explicitly instead of relying on xterm's internal touch handler (which loses to iOS page panning) or on `overflow: hidden` (which iOS ignores for touch). Four changes: (1) pin `TerminalView`'s root with `position: fixed` + `100dvh`; (2) `touch-action: none` on the terminal body so iOS never starts a page pan; (3) a custom capture-phase touch handler that converts drag pixels to rows and scrolls the terminal; (4) drop the inert `.xterm-viewport` CSS from the first attempt. The pixels→rows math is a pure, unit-tested helper.

> **Implementation note (supersedes step 3 below where it says `scrollLines`).** During implementation we found `term.scrollLines()` is a no-op here: Claude's TUI runs in the alternate screen buffer, which has no xterm scrollback. The handler instead forwards the drag to the pty as SGR (1006) mouse-wheel events via a second pure helper `wheelSequences(lines)`, gated on `term.modes.mouseTrackingMode !== "none"` so it never injects literal bytes when the foreground app has mouse tracking off. Task 3's code snippet is kept as originally written for the record; the shipped `src/components/TerminalView.tsx` and `src/lib/touchScroll.ts` reflect the wheel-event version.

Corrected root cause and rationale: `docs/superpowers/specs/2026-07-14-mobile-terminal-scroll-redo-design.md`.

**Tech Stack:** Next.js (client component), React `useEffect`, `@xterm/xterm` ^5.5.0 (`Terminal.scrollLines`, `Terminal.rows` — public API), plain CSS in `src/app/globals.css`, vitest (`node` env).

## Global Constraints

- No new dependencies; no xterm/addon version change.
- Do not alter list/tickets/sessions page scrolling — only the terminal view.
- All code artifacts in English.
- vitest runs in the `node` environment (`vitest.config.ts`), test glob `tests/**/*.test.ts`, path alias `@ -> src`. No jsdom/happy-dom is installed, so only non-DOM (pure) code is unit-tested; DOM wiring is verified manually.
- Behavioural verification is a **real iPhone 11 / Safari** check (the QA gate). Chrome DevTools device mode does not reproduce iOS WebKit touch behaviour and is not sufficient.
- Work happens in the worktree `.worktrees/ricventu/ric-107-scroll-del-terminale-non-funziona` on branch `ricventu/ric-107-scroll-del-terminale-non-funziona`. `cd` into it and confirm the branch (`git branch --show-current`) before any edit or commit; never commit to `main`.

---

### Task 1: Pure pixels→rows helper (`computeTouchScroll`)

Extract the sign- and accumulation-sensitive conversion into a pure function so it can be unit-tested without a DOM. Given the accumulated vertical drag in pixels and the height of one terminal row, return how many whole rows to scroll and the leftover pixels to carry into the next move.

**Files:**
- Create: `src/lib/touchScroll.ts`
- Test: `tests/client/touchScroll.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeTouchScroll(accumulatedPx: number, rowHeightPx: number): { lines: number; remainderPx: number }`. `lines` is passed directly to `Terminal.scrollLines` (positive = scroll down/toward present, negative = scroll up/into history). `remainderPx` becomes the next call's `accumulatedPx` seed so sub-row drags accumulate instead of being lost.

- [ ] **Step 1: Write the failing test**

Create `tests/client/touchScroll.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeTouchScroll } from "@/lib/touchScroll";

describe("computeTouchScroll", () => {
  it("returns zero lines and carries a sub-row drag as remainder", () => {
    expect(computeTouchScroll(10, 18)).toEqual({ lines: 0, remainderPx: 10 });
  });

  it("converts an upward-drag accumulator to a positive (scroll-down) line count", () => {
    expect(computeTouchScroll(20, 18)).toEqual({ lines: 1, remainderPx: 2 });
  });

  it("converts a downward-drag accumulator to a negative (scroll-up) line count", () => {
    expect(computeTouchScroll(-20, 18)).toEqual({ lines: -1, remainderPx: -2 });
  });

  it("truncates multiple rows and carries the remainder", () => {
    expect(computeTouchScroll(50, 18)).toEqual({ lines: 2, remainderPx: 14 });
  });

  it("guards against a zero or negative row height", () => {
    expect(computeTouchScroll(100, 0)).toEqual({ lines: 0, remainderPx: 0 });
    expect(computeTouchScroll(100, -5)).toEqual({ lines: 0, remainderPx: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/touchScroll.test.ts`
Expected: FAIL — cannot resolve `@/lib/touchScroll` (module not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/touchScroll.ts`:

```ts
/**
 * Convert an accumulated vertical touch-drag (in pixels) into a whole number of
 * terminal rows to scroll, returning the leftover pixels to carry forward.
 *
 * Sign matches xterm's `Terminal.scrollLines`: positive scrolls down (toward the
 * present), negative scrolls up (into history). The caller accumulates
 * `previousClientY - currentClientY`, so an upward drag yields a positive value.
 */
export function computeTouchScroll(
  accumulatedPx: number,
  rowHeightPx: number,
): { lines: number; remainderPx: number } {
  if (rowHeightPx <= 0) return { lines: 0, remainderPx: 0 };
  const lines = Math.trunc(accumulatedPx / rowHeightPx);
  const remainderPx = accumulatedPx - lines * rowHeightPx;
  return { lines, remainderPx };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/client/touchScroll.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/touchScroll.ts tests/client/touchScroll.test.ts
git commit -m "feat(mojito): pure pixels-to-rows helper for terminal touch scroll (RIC-107)"
```

---

### Task 2: Terminal-view CSS — fixed pin, no page pan, drop inert rule

Pin the terminal root to the visible viewport with `position: fixed`, mark the terminal body as a non-pan surface, and remove the inert `.xterm-viewport` rule the first fix added.

**Files:**
- Modify: `src/app/globals.css` (the `/* ---- Terminal view ---- */` section, lines 184–206)

**Interfaces:**
- Consumes: the `.term-root` class applied to `TerminalView`'s root element in Task 3.
- Produces: the `.term-root` layout contract (fixed, full visible-viewport, column flex) that Task 3's root element relies on instead of its former inline style.

- [ ] **Step 1: Remove the inert viewport rule**

In `src/app/globals.css`, delete this block (currently lines 200–206):

```css
/* xterm's scrollable viewport must own touch scrolling on mobile so the
   scrollback scrolls instead of chaining out to the (locked) document. */
.xterm .xterm-viewport {
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 2: Add the terminal-root and touch-action rules**

In `src/app/globals.css`, in the `/* ---- Terminal view ---- */` section (immediately after the `.gate .btns .btn { flex: 1; padding: 13px; }` line, line 198), add:

```css
/* The terminal view replaces the whole page. Pin it to the visible viewport
   with position:fixed (100dvh alone is not enough — iOS Safari still lets the
   page pan). A fixed element is out of page flow, so there is nothing to pan. */
.term-root {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overscroll-behavior: none;
}

/* The terminal body is not a browser pan surface — iOS must not start a page
   pan when a drag begins over it. Scrolling is driven in JS (see TerminalView).
   The accessory bar keeps its default touch-action so its horizontal scroll
   still works. */
.term-root .xterm {
  touch-action: none;
}
```

- [ ] **Step 3: Build to confirm the CSS compiles**

Run: `npm run build`
Expected: PASS (Next.js build succeeds; no CSS errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "fix(mojito): pin terminal view with fixed position, drop inert viewport css (RIC-107)"
```

---

### Task 3: TerminalView wiring — use `.term-root` and a custom touch-scroll handler

Apply the `.term-root` class to the root element and add a capture-phase touch handler that drives `term.scrollLines()` via `computeTouchScroll`, so xterm's own touch handler does not also fire and the page never pans.

**Files:**
- Modify: `src/components/TerminalView.tsx`
  - imports (top of file, near line 8)
  - add a new `useEffect` after the existing document-lock effect (ends line 94)
  - root element (line 130)

**Interfaces:**
- Consumes: `computeTouchScroll` from `@/lib/touchScroll` (Task 1); `termRef` (`Terminal | null`, declared line 17), `holder` (`HTMLDivElement` ref, line 15); xterm public API `term.rows` and `term.scrollLines(n)`.
- Produces: nothing new (self-contained mount/unmount side effect + class swap).

- [ ] **Step 1: Import the helper**

In `src/components/TerminalView.tsx`, after the existing `import { apiFetch } from "@/lib/client";` (line 8), add:

```tsx
import { computeTouchScroll } from "@/lib/touchScroll";
```

- [ ] **Step 2: Add the custom touch-scroll effect**

In `src/components/TerminalView.tsx`, immediately after the existing document-lock `useEffect` (the one whose cleanup returns at lines 89–93, closing `}, []);` at line 94), add this effect. It reads `termRef.current` live inside the handlers so a terminal re-creation (the setup effect's deps are `[session.id, token]`) cannot leave it holding a stale `Terminal`:

```tsx
// Mobile touch scroll. xterm's built-in touchmove handler is unreliable on iOS
// Safari — the page wins the gesture and pans. Own it: capture-phase listeners
// (stopPropagation so xterm's own handler does not also fire and double-scroll),
// accumulate the drag, and drive the scrollback via the public scrollLines API.
useEffect(() => {
  const el = holder.current;
  if (!el) return;
  let lastY = 0;
  let acc = 0;
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    lastY = e.touches[0].clientY;
    acc = 0;
    e.stopPropagation();
  };
  const onMove = (e: TouchEvent) => {
    const term = termRef.current;
    if (!term || e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    acc += lastY - y;
    lastY = y;
    const rowHeightPx = term.rows > 0 ? el.clientHeight / term.rows : 0;
    const { lines, remainderPx } = computeTouchScroll(acc, rowHeightPx);
    if (lines !== 0) {
      term.scrollLines(lines);
      acc = remainderPx;
    }
    e.stopPropagation();
    e.preventDefault();
  };
  el.addEventListener("touchstart", onStart, { passive: true, capture: true });
  el.addEventListener("touchmove", onMove, { passive: false, capture: true });
  return () => {
    el.removeEventListener("touchstart", onStart, { capture: true } as EventListenerOptions);
    el.removeEventListener("touchmove", onMove, { capture: true } as EventListenerOptions);
  };
}, []);
```

- [ ] **Step 3: Swap the root element's inline style for the class**

In `src/components/TerminalView.tsx`, change the root element (line 130) from:

```tsx
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
```

to:

```tsx
    <div className="term-root">
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "fix(mojito): drive terminal scrollback from a custom touch handler (RIC-107)"
```

---

### Task 4: Manual verification on the real iPhone 11 (QA gate)

The behavioural fix cannot be exercised by any automated harness in this repo, and Chrome DevTools device mode does not reproduce iOS WebKit touch behaviour. This is the real-device gate.

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the app and reach it from the phone**

Run: `npm run dev`
Open the app on the iPhone 11 in Safari (the dev server prints a Wi-Fi URL), enter the token, and open a session whose terminal has enough output to overflow the visible area (produce scrollback if needed).

- [ ] **Step 2: Verify the gesture on the device**

- Drag up/down **inside** the terminal (with Claude's TUI in the foreground) → Claude scrolls its own transcript under the finger; the page does **not** move. (Scrolling is driven by forwarded wheel events, so boundary behaviour at the top/bottom is Claude's, not xterm's — this is expected.)
- Drag at the top of the transcript → the page does not pan / rubber-band into the page.
- **Tap the terminal → the soft keyboard appears and typed text reaches the session.** The custom handler `preventDefault`s every `touchmove` and captures `touchstart`, so confirm a tap (with slight finger jitter) still focuses xterm and raises the keyboard. If it fails, add a movement threshold so near-pure taps pass through before the first `preventDefault`.
- Tap "‹" back → the tickets/sessions list scrolls normally again (document scroll restored on unmount).

Expected: terminal scrolls under the finger; page stays fixed while the terminal is open; tapping still focuses the terminal and shows the keyboard; list scroll works after backing out.

- [ ] **Step 3: Final checks**

Run: `npm run typecheck && npm run build && npx vitest run`
Expected: all PASS.

- [ ] **Step 4: No commit**

This task changes no files. If Step 2 fails on the device, return to `superpowers:systematic-debugging` (capture live evidence via Safari Web Inspector over USB — is `onMove` firing? is `preventDefault` honored? is `term.rows`/`clientHeight` sane?) before attempting another change. Do not layer on speculative fixes.
