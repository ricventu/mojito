# Mobile Terminal Scroll — Root Cause & Fix Spec (RIC-107)

## Symptom

On Safari / iPhone 11, dragging inside the terminal view does not scroll the
terminal scrollback. Instead the whole page scrolls.

## Root cause

The terminal screen replaces the entire page (`page.tsx:35` renders
`TerminalView` in place of the list when a session is open). Its root element is
sized `height: 100vh` (`TerminalView.tsx:101`).

On mobile Safari, `100vh` resolves to the **largest** viewport height (browser
chrome retracted), which is taller than the *visible* viewport while the chrome
is shown. Combined with `html, body { height: 100% }` and **no overflow lock**
(`globals.css:39`), the document itself becomes vertically scrollable on the
terminal page.

A touch-drag over the terminal is therefore consumed by that document-level
scroll (panning the whole page under the browser chrome) and never reaches
xterm's inner `.xterm-viewport`, which is the element that actually holds the
scrollback (`node_modules/@xterm/xterm/css/xterm.css:93` — `overflow-y: scroll`,
absolutely positioned to fill the holder). Result: "the page scrolls, not the
terminal."

Contributing factor: `.xterm-viewport` carries no `touch-action` /
`overscroll-behavior` / `-webkit-overflow-scrolling`, so even without the
document overflow, touch scrolling is not explicitly contained to the terminal.

## Fix

Three coordinated changes, smallest blast radius:

1. **Fit the visual viewport.** `TerminalView` root `height: 100vh` →
   `height: 100dvh` (dynamic viewport height; tracks the visible viewport on
   mobile Safari, iOS 15.4+). Removes the document overflow that steals the
   gesture.

2. **Lock document scroll while the terminal is mounted.** A `useEffect` in
   `TerminalView` sets `overflow: hidden` (and `overscroll-behavior: none`) on
   `<html>` and `<body>` on mount, restoring the prior values on unmount. The
   list view keeps its normal page scroll; only the terminal locks it.

3. **Contain touch scroll inside the xterm viewport.** In `globals.css`, target
   `.xterm .xterm-viewport` with `touch-action: pan-y`,
   `overscroll-behavior: contain`, and `-webkit-overflow-scrolling: touch` so
   the scrollback scrolls with momentum and does not chain out to the document.

## Non-goals

- No xterm version bump or addon changes.
- No change to the list/tickets/sessions scroll behaviour.
- No new dependencies.

## Verification

Manual (no DOM/touch unit-test harness exists — tests are server-only under
`tests/server/`):

- Mobile Safari (or Chrome DevTools device mode with touch emulation): open a
  session with enough output to overflow, drag up/down inside the terminal →
  the scrollback scrolls and the page stays fixed. Back out → the list scrolls
  normally again.
- `npm run typecheck` and `npm run build` pass.
