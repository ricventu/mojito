# Mobile Keyboard Hides Terminal Input — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On mobile, keep the terminal's active input line and the accessory bar visible above the virtual keyboard instead of behind it.

**Architecture:** The session terminal view (`.term-root`) is `position: fixed; height: 100dvh`, so it sizes to the full *layout* viewport. When the mobile virtual keyboard opens, only the *visual* viewport shrinks (default `interactive-widget=resizes-visual`), so the container keeps extending under the keyboard and its bottom band — the active prompt line plus the accessory bar — is occluded. The fix makes `TerminalView` track `window.visualViewport` and size `.term-root` to the visible band above the keyboard, re-fitting xterm on each change, and adds `interactive-widget=resizes-content` to the viewport meta as a declarative complement for Chromium. The visual-viewport handler is the load-bearing, cross-browser fix (iOS Safari support for `interactive-widget` is unreliable).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, `@xterm/xterm` 5.5 + `@xterm/addon-fit` 0.10, Vitest 2 (node environment).

## Global Constraints

- All code artifacts in English (identifiers, comments, commit messages).
- Tests live under `tests/**/*.test.ts`; import app code via the `@` alias (`@` → `src`). Vitest runs in the `node` environment — the testable unit must be a pure function (no DOM). This mirrors the existing `src/lib/touchScroll.ts` + `tests/client/touchScroll.test.ts` precedent.
- Verify the whole suite with `npx tsc --noEmit && npx vitest run` from the worktree.
- Do NOT run a dev server or build from the main checkout while the live dev server on `:8700` is up — it shares `.next`. Manual verification runs from this worktree, on a different port if `:8700` is occupied.

---

### Task 1: Pure helper — compute the `.term-root` style from visual-viewport metrics

Encapsulate the only logic worth testing (rounding, clamping, string formatting) in a pure function, mirroring `src/lib/touchScroll.ts`. The DOM wiring in Task 2 stays a thin, untested glue layer.

**Files:**
- Create: `src/lib/keyboardInset.ts`
- Test: `tests/client/keyboardInset.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface VisualViewportMetrics { height: number; offsetTop: number }`
  - `interface TermRootStyle { height: string; transform: string }`
  - `function termRootStyle(vv: VisualViewportMetrics): TermRootStyle` — returns the inline `height` (px string) and `transform` (`translateY(<px>)`) to apply to the fixed `.term-root` so it covers exactly the visible band. Values are rounded to whole pixels and clamped to `>= 0`.

- [ ] **Step 1: Write the failing test**

Create `tests/client/keyboardInset.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { termRootStyle } from "@/lib/keyboardInset";

describe("termRootStyle", () => {
  it("keyboard closed: fills the full viewport with no offset", () => {
    expect(termRootStyle({ height: 844, offsetTop: 0 })).toEqual({
      height: "844px",
      transform: "translateY(0px)",
    });
  });

  it("keyboard open: shrinks height to the visible band", () => {
    expect(termRootStyle({ height: 500, offsetTop: 0 })).toEqual({
      height: "500px",
      transform: "translateY(0px)",
    });
  });

  it("offset visual viewport: shifts the fixed container down to the visible top", () => {
    expect(termRootStyle({ height: 500, offsetTop: 40 })).toEqual({
      height: "500px",
      transform: "translateY(40px)",
    });
  });

  it("rounds fractional metrics to whole pixels", () => {
    expect(termRootStyle({ height: 499.6, offsetTop: 12.3 })).toEqual({
      height: "500px",
      transform: "translateY(12px)",
    });
  });

  it("clamps negative metrics to zero", () => {
    expect(termRootStyle({ height: -10, offsetTop: -5 })).toEqual({
      height: "0px",
      transform: "translateY(0px)",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/keyboardInset.test.ts`
Expected: FAIL — cannot resolve `@/lib/keyboardInset` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/keyboardInset.ts`:

```ts
/**
 * Geometry for pinning the terminal view to the *visible* viewport.
 *
 * `.term-root` is `position: fixed; top: 0; height: 100dvh`, so it sizes to the
 * full layout viewport. When the mobile virtual keyboard opens, only the visual
 * viewport shrinks (the default `interactive-widget=resizes-visual`), so the
 * container keeps extending under the keyboard and its bottom band — the active
 * input line and the accessory bar — is hidden. Sizing the container to
 * `visualViewport.height` (and shifting it by `visualViewport.offsetTop`, which
 * is non-zero when the visible band is scrolled away from the layout top) keeps
 * that band above the keyboard.
 */
export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

export interface TermRootStyle {
  height: string;
  transform: string;
}

export function termRootStyle(vv: VisualViewportMetrics): TermRootStyle {
  const height = Math.max(0, Math.round(vv.height));
  const offset = Math.max(0, Math.round(vv.offsetTop));
  return { height: `${height}px`, transform: `translateY(${offset}px)` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/client/keyboardInset.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/keyboardInset.ts tests/client/keyboardInset.test.ts
git commit -m "feat(mojito): termRootStyle helper for visible-viewport sizing (RIC-124)"
```

---

### Task 2: Wire the visual-viewport handler into TerminalView + viewport meta

Make `TerminalView` track `window.visualViewport`, size `.term-root` to the visible band via `termRootStyle`, and re-fit xterm so Claude's prompt line lands inside it. Add `interactive-widget=resizes-content` to the viewport meta as a declarative complement.

**Files:**
- Modify: `src/components/TerminalView.tsx` (main terminal effect, lines ~22–93; JSX root `<div className="term-root">`, line ~174)
- Modify: `src/app/layout.tsx:6` (the `viewport` export)

**Interfaces:**
- Consumes: `termRootStyle` and `VisualViewportMetrics` from `@/lib/keyboardInset` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `interactive-widget=resizes-content` to the viewport meta**

In `src/app/layout.tsx`, change the `viewport` export (line 6) from:

```tsx
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" as const };
```

to:

```tsx
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  // Ask supporting browsers (Chromium) to shrink the layout viewport when the
  // virtual keyboard opens so `100dvh` reflects the space above it. iOS Safari
  // ignores this; the visualViewport handler in TerminalView is the actual fix.
  interactiveWidget: "resizes-content" as const,
};
```

- [ ] **Step 2: Import the helper and add a ref to the root element in TerminalView**

In `src/components/TerminalView.tsx`:

Add the import alongside the existing imports (near line 10):

```tsx
import { termRootStyle } from "@/lib/keyboardInset";
```

Add a ref next to the existing refs (after `const holder = useRef<HTMLDivElement>(null);`, line 17):

```tsx
const rootRef = useRef<HTMLDivElement>(null);
```

Attach it to the root element — change the JSX opening tag (line ~174) from:

```tsx
    <div className="term-root">
```

to:

```tsx
    <div className="term-root" ref={rootRef}>
```

- [ ] **Step 3: Track the visual viewport inside the main terminal effect**

In the main `useEffect` (the one that creates `term`, `fit`, and connects the WebSocket, lines ~22–93), just after the existing window-resize wiring:

```tsx
    const onResize = () => {
      fit.fit();
      wsRef.current?.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
    };
    window.addEventListener("resize", onResize);
```

add the visual-viewport handler:

```tsx
    // The mobile virtual keyboard shrinks only the visual viewport, so pin
    // `.term-root` to it (see keyboardInset.ts) and re-fit xterm to the reduced
    // height, keeping the active prompt line and the accessory bar above the
    // keyboard. `window resize` alone does not fire for a keyboard that only
    // resizes the visual viewport, so this listener is required.
    const vv = window.visualViewport;
    const applyViewport = () => {
      const root = rootRef.current;
      if (!root || !vv) return;
      const style = termRootStyle({ height: vv.height, offsetTop: vv.offsetTop });
      root.style.height = style.height;
      root.style.transform = style.transform;
      fit.fit();
      wsRef.current?.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
      term.scrollToBottom();
    };
    if (vv) {
      vv.addEventListener("resize", applyViewport);
      vv.addEventListener("scroll", applyViewport);
      applyViewport();
    }
```

Then extend the effect's cleanup (the returned function, lines ~85–92) to remove the listeners. Change:

```tsx
    return () => {
      closed = true;
      clearTimeout(retry);
      onData.dispose();
      window.removeEventListener("resize", onResize);
      wsRef.current?.close();
      term.dispose();
    };
```

to:

```tsx
    return () => {
      closed = true;
      clearTimeout(retry);
      onData.dispose();
      window.removeEventListener("resize", onResize);
      if (vv) {
        vv.removeEventListener("resize", applyViewport);
        vv.removeEventListener("scroll", applyViewport);
      }
      wsRef.current?.close();
      term.dispose();
    };
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: `tsc` reports no errors; all tests pass (baseline 171 + the 5 from Task 1 = 176), 0 failures.

- [ ] **Step 5: Manual verification on a real mobile device**

Desktop Chrome device emulation does NOT simulate the virtual keyboard resizing `visualViewport`, so this must be verified on a real phone (the app already serves over the LAN — the bug screenshot shows `192.168.0.18`).

1. From this worktree, start the dev server. If the live dev server is already on `:8700`, use another port, e.g. `PORT=8701 npm run dev` — never start it from the main checkout while `:8700` is up (shared `.next`).
2. On the phone, open the app over the LAN, unlock with the token, open a running session so `TerminalView` fills the screen.
3. Tap the terminal to raise the keyboard. **Confirm:** the accessory bar (`Esc Tab ↑ ↓ …`) and the terminal's active prompt line stay visible directly above the keyboard, and typed characters appear.
4. Dismiss the keyboard. **Confirm:** the terminal re-expands to the full height with no gap or clipped rows.
5. Rotate the device and repeat step 3 to confirm re-fit on orientation change.

Optional desktop smoke check (does not replace the device check): with a session open, run in the devtools console — `visualViewport.dispatchEvent(new Event('resize'))` — and confirm no exception and that `.term-root` gets inline `height`/`transform` styles.

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx src/app/layout.tsx
git commit -m "fix(mojito): keep terminal input above the mobile keyboard (RIC-124)"
```

---

## Self-Review

- **Spec coverage:** The single requirement — the input must be visible with the mobile keyboard open — is met by Task 2 (visual-viewport sizing + re-fit + declarative viewport meta), with the geometry in Task 1. No other requirement in the ticket.
- **Placeholder scan:** none — every code and command step is concrete.
- **Type consistency:** `termRootStyle(vv: VisualViewportMetrics): TermRootStyle` is defined in Task 1 and consumed with matching shape in Task 2 (`{ height, offsetTop }` in, `{ height, transform }` applied as inline styles). `rootRef` typed `HTMLDivElement` matches the `.term-root` div.
