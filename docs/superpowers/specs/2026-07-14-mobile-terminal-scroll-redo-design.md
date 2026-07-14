# Mobile Terminal Scroll — Corrected Root Cause & Fix Spec (RIC-107, redo)

> Supersedes `2026-07-13-mobile-terminal-scroll-design.md`. That fix shipped
> (merged to `main`, ticket reached Done) but **did not** fix the bug on the real
> iPhone 11 / Safari, so the ticket was reopened. This document corrects the
> root-cause analysis and specifies a fix that does not depend on the mechanism
> the first attempt targeted.

## Symptom (unchanged)

On Safari / iPhone 11, dragging inside the terminal view does not scroll the
terminal scrollback. Instead the whole page pans. Reported again after the first
fix was merged.

## Why the first fix did not work (verified against `@xterm/xterm@5.5.0` source)

The first fix made three changes; two of them target a mechanism that is not
actually in play.

1. **`.xterm .xterm-viewport { touch-action: pan-y; overscroll-behavior:
   contain; -webkit-overflow-scrolling: touch }` — inert.**
   xterm does **not** scroll via native browser scrolling of `.xterm-viewport`.
   In `bindMouse()` (`lib/xterm.js`) xterm binds `wheel`, `touchstart` and
   `touchmove` listeners to **`this.element`** (the `.xterm` root) and scrolls
   the buffer itself in JavaScript: `handleTouchMove` does
   `this._viewportElement.scrollTop += Δ` and calls `preventDefault()` (listener
   registered `{passive:false}`) while there is scrollback left to consume;
   at the top/bottom boundary it stops preventing default so the gesture bubbles.
   Because the gesture is handled by JS on the `.xterm` root — and because
   `.xterm-viewport` is painted *under* `.xterm-screen` and is never the touch
   target — CSS on `.xterm-viewport` has no effect on the gesture. This change
   did nothing.

2. **`html, body { overflow: hidden }` document lock — insufficient on iOS.**
   iOS Safari does not reliably honor `overflow: hidden` for touch panning /
   rubber-banding. A `position: fixed` pin (or `preventDefault` on the moving
   touch) is required to actually stop the page from panning on iOS.

3. **`100vh → 100dvh` root height — correct, keep it.**

Net: the first fix changed nothing on the touch path over xterm's own default
behaviour, which is why it passed review, reached Done, and still failed on the
device.

## Root cause

The terminal cannot be scrolled by touch on iOS Safari because the only
touch-scroll path is xterm's built-in `touchmove` handler, whose
`preventDefault` competes with — and loses to — the page's own touch panning on
iOS (and can additionally mis-fire when its boundary math reads stale
viewport/buffer heights after a `dvh`/FitAddon resize). Nothing in the app
guarantees the terminal owns the vertical drag gesture, so iOS routes it to the
page.

## Fix (robust, device-agnostic)

Own the gesture explicitly instead of relying on xterm's internal handler or on
iOS honoring `overflow: hidden`. Four coordinated changes:

1. **Pin the terminal to the visible viewport with `position: fixed`.** Move the
   `TerminalView` root's inline layout to a `.term-root` class that is
   `position: fixed; top/left/right: 0; height: 100dvh` (keeps the correct
   `dvh` sizing, adds the fixed pin iOS needs). A fixed element is out of page
   flow, so the page has nothing to pan.

2. **Tell the browser the terminal body is not a pan surface.**
   `.term-root .xterm { touch-action: none; }` so iOS never starts a native
   page pan when the drag begins over the terminal. (The accessory bar keeps its
   own default `touch-action` so its horizontal scroll still works.)

3. **Drive the scrollback from a custom touch handler.** In `TerminalView`, add
   `touchstart`/`touchmove` listeners on the terminal holder, registered in the
   **capture** phase with `stopPropagation()` (so xterm's own touch handler does
   not also fire and double-scroll) and `{passive:false}` `preventDefault()`.
   Accumulate the vertical drag in pixels, convert to whole rows, and call the
   public `term.scrollLines(lines)` API. This path does not depend on
   `.xterm-viewport`, on xterm's boundary math, or on iOS overflow behaviour.

4. **Remove the inert `.xterm .xterm-viewport` rule** added by the first fix.

The pixels→rows conversion (the sign- and accumulation-sensitive part) is
extracted into a pure helper `computeTouchScroll(accumulatedPx, rowHeightPx)` so
it can be unit-tested in the `node` vitest environment; the DOM wiring itself
remains manually verified.

The existing mount-time `html/body { overflow: hidden; overscroll-behavior:
none }` effect is kept as a secondary defence-in-depth layer (harmless, helps
non-iOS), but it is no longer the primary mechanism.

### Sign convention

`term.scrollLines(n)`: `n > 0` scrolls **down** (toward the present), `n < 0`
scrolls **up** (into history). Dragging the finger **down** (clientY increases)
reveals older content → scroll up (negative); dragging **up** → scroll down
(positive). The handler accumulates `lastY - currentY`, so a downward drag
produces a negative accumulator and an upward drag a positive one, matching the
API sign directly.

## Non-goals

- No xterm version bump or addon changes.
- No change to the list / tickets / sessions scroll behaviour.
- No new dependencies.

## Verification

- **Unit (automated):** `computeTouchScroll` — sign, whole-row truncation,
  sub-row remainder carry, zero/negative row height guard. Runs under the
  existing `node` vitest config.
- **Behavioural (manual — the QA gate):** real iPhone 11 / Safari. Open a
  session with enough output to overflow, drag up/down **inside** the terminal →
  the scrollback scrolls under the finger and the page stays fixed. Back out →
  the tickets/sessions list scrolls normally again. (Chrome DevTools device mode
  does not reproduce iOS WebKit touch behaviour, so it is not sufficient for this
  gate.)
- `npm run typecheck` and `npm run build` pass.
