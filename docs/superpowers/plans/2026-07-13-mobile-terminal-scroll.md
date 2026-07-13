# Mobile Terminal Scroll Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make touch-dragging inside the terminal scroll the terminal scrollback instead of the whole page on mobile Safari (RIC-107).

**Architecture:** Three coordinated changes with the smallest blast radius: (1) size the terminal root to the *visible* viewport with `100dvh`, (2) lock document scroll only while the terminal view is mounted, (3) contain touch scrolling to xterm's own viewport via global CSS. Root cause and rationale are in `docs/superpowers/specs/2026-07-13-mobile-terminal-scroll-design.md`.

**Tech Stack:** Next.js (client component), React `useEffect`, `@xterm/xterm` ^5.5.0, plain CSS in `src/app/globals.css`.

## Global Constraints

- No new dependencies; no xterm/addon version change.
- Do not alter list/tickets/sessions page scrolling — only the terminal view.
- All code artifacts in English.
- No automated DOM/touch test harness exists (tests are server-only under `tests/server/`). Verification for the behavioural fix is manual (mobile Safari or Chrome DevTools device mode) plus `npm run typecheck` and `npm run build`.
- Work happens in the worktree `.worktrees/ricventu/ric-107-scroll-del-terminale-non-funziona` on branch `ricventu/ric-107-scroll-del-terminale-non-funziona`. `cd` into it and confirm the branch before any edit or commit; never commit to `main`.

---

### Task 1: Fit the terminal root to the visible viewport

Replace the fixed `100vh` root height with `100dvh` so the terminal exactly fills the visible viewport on mobile Safari, eliminating the document overflow that steals the touch gesture.

**Files:**
- Modify: `src/components/TerminalView.tsx:101`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (internal style change only).

- [ ] **Step 1: Change the root height**

In `src/components/TerminalView.tsx`, the returned root element (currently line 101):

```tsx
<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
```

becomes:

```tsx
<div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "fix(mojito): size terminal root to dvh so it fits mobile viewport (RIC-107)"
```

---

### Task 2: Lock document scroll while the terminal is mounted

Prevent any residual document-level scroll from consuming the touch gesture: while `TerminalView` is mounted, disable scrolling on `<html>` and `<body>`, and restore the prior inline values on unmount.

**Files:**
- Modify: `src/components/TerminalView.tsx` (add a new `useEffect`, after the existing terminal-setup effect that ends at line 65)

**Interfaces:**
- Consumes: React `useEffect` (already imported at line 2).
- Produces: nothing new (self-contained mount/unmount side effect).

- [ ] **Step 1: Add the scroll-lock effect**

In `src/components/TerminalView.tsx`, add this effect immediately after the existing terminal-setup `useEffect` (the one whose cleanup returns at line 57–64). It has an empty dependency array so it runs once on mount and cleans up on unmount:

```tsx
useEffect(() => {
  const html = document.documentElement;
  const body = document.body;
  const prev = {
    htmlOverflow: html.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyOverscroll: body.style.overscrollBehavior,
  };
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  return () => {
    html.style.overflow = prev.htmlOverflow;
    body.style.overflow = prev.bodyOverflow;
    body.style.overscrollBehavior = prev.bodyOverscroll;
  };
}, []);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/TerminalView.tsx
git commit -m "fix(mojito): lock document scroll while terminal view is open (RIC-107)"
```

---

### Task 3: Contain touch scrolling inside the xterm viewport

Ensure the scrollback element handles touch scrolling with momentum and does not chain out to the (now-locked) document.

**Files:**
- Modify: `src/app/globals.css` (add a rule in the "Terminal view" section, after line 188)

**Interfaces:**
- Consumes: xterm's `.xterm .xterm-viewport` element (rendered at runtime by `@xterm/xterm`).
- Produces: nothing new.

- [ ] **Step 1: Add the viewport touch rule**

In `src/app/globals.css`, under the `/* ---- Terminal view ---- */` section, add:

```css
/* xterm's scrollable viewport must own touch scrolling on mobile so the
   scrollback scrolls instead of chaining out to the (locked) document. */
.xterm .xterm-viewport {
  touch-action: pan-y;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 2: Build to confirm CSS compiles**

Run: `npm run build`
Expected: PASS (Next.js build succeeds; no CSS/Tailwind errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "fix(mojito): contain xterm viewport touch scroll on mobile (RIC-107)"
```

---

### Task 4: Manual verification on a mobile viewport

Confirm the fix end-to-end. No automated harness can exercise iOS touch scrolling; this task is the behavioural gate.

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the app**

Run: `npm run dev`
Open the app, enter the token, and open a session whose terminal has enough output to overflow the visible area (produce scrollback if needed).

- [ ] **Step 2: Verify on a mobile viewport**

Use Chrome DevTools device mode (e.g. iPhone) with touch emulation, or a real iPhone Safari:
- Drag up/down **inside** the terminal → the terminal scrollback scrolls; the page does **not** move.
- Tap "‹" back → the tickets/sessions list scrolls normally again (document scroll restored).

Expected: terminal scrolls under the finger; page stays fixed while the terminal is open; list scroll works after backing out.

- [ ] **Step 3: Final checks**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 4: No commit**

This task changes no files. If Step 2 fails, return to systematic-debugging (the document is still scrollable or the viewport is not receiving touch) before re-attempting.
