# Terminal mobile paste — design

## Problem

On mobile (iOS Safari, app opened over a LAN IP), the user cannot paste text into
the running session's terminal.

Root cause is twofold:

1. **No editable target.** The terminal is an xterm.js canvas/div, not a visible
   editable field. A long-press offers no "Paste" ("Incolla") item because there is
   nothing editable under the finger. `.term-root .xterm { touch-action: none }`
   (`src/app/globals.css:288`) plus the capture-phase touch handlers in
   `TerminalView.tsx` (lines 235–236) further suppress the native callout menu.
2. **Clipboard API unavailable.** The app is served over plain HTTP on `0.0.0.0`
   (`server.ts:1,38,81`), so over a LAN IP it is a **non-secure context** and
   `navigator.clipboard` is `undefined` — the same reason the code already guards
   `crypto.randomUUID` in `NewTicketSheet.tsx:13-18`. A JS-driven "Paste" button that
   reads the clipboard cannot work here.

Key enabling fact: the **`paste` DOM event and `clipboardData.getData('text')` DO
work over HTTP** in an editable field — only the async `navigator.clipboard` API needs
a secure context. So a native long-press → "Incolla" into a real editable field hands
us the text with no certificate and no HTTPS.

Scope: **terminal text paste only.** New-ticket image paste is explicitly out of scope
for this change (covered separately by the existing "Add image" → Photos flow).

## Approach

Add a reveal-on-demand paste field to the terminal's accessory bar. The user taps a
`📋` button, a real `<textarea>` appears, they paste into it natively (works over HTTP),
**review/edit** the text, then tap **Inietta** to inject it into the terminal.

Rejected alternatives:
- *Always-visible paste field* — costs a permanent row above the on-screen keyboard.
- *Native long-press on the terminal itself* — fragile on iOS (no editable target,
  `touch-action: none`); likely wouldn't work at all.

## Components

### `AccessoryBar.tsx`
Owns the whole paste UI and its local state.

- New prop: `onPasteText: (text: string) => void`.
- New `📋` button appended after the existing key row. It does **not** send bytes; it
  toggles a local `open` boolean.
- When `open`, render a focused `<textarea>` (auto-focus on mount) plus an **Inietta**
  button and a `×` cancel button.
  - `<textarea>` — **not** `<input>`: a plain `<input>` strips newlines from a
    multi-line paste; a textarea preserves them.
  - No `preventDefault` on paste — let the textarea hold the value natively; read
    `.value` on inject.
- **Inietta**: `const text = normalizePaste(value); if (text) { onPasteText(text); }`
  then clear the value and set `open = false`.
- `×`: clear and close without injecting.
- `📋` is always rendered (harmless on desktop, where native ctrl+v into xterm still
  works too). No touch detection.

### `TerminalView.tsx`
Wires the injection to xterm:

```
<AccessoryBar onSend={send} onPasteText={(t) => termRef.current?.paste(t)} />
```

`termRef.current?.paste(t)` routes the text through xterm's own paste path, which
applies **bracketed-paste** wrapping when the app enabled it (mode 2004) — identical to
a desktop paste. This is why a multi-line paste is NOT interpreted as multiple Enters
by Claude's TUI: inside bracketed paste, newlines are literal. The paste fires xterm's
`onData` (`TerminalView.tsx:115`) → WebSocket → pty. The text lands in Claude's
**editable prompt line, not submitted**; the user presses `⏎` in the terminal to send.

### `normalizePaste` helper (pure, testable)
Extract a small pure function into its own module, `src/lib/pasteText.ts`, so the unit
test imports it without pulling in the React component:

```
normalizePaste(value: string): string | null
// returns value if it contains at least one non-whitespace char, else null
```

`AccessoryBar.tsx` imports `normalizePaste` from `@/lib/pasteText`.

## Data flow

1. Tap `📋` → `open = true` → focused `<textarea>` + **Inietta** + `×` appear.
2. Long-press → **Incolla** (native, HTTP-safe) → text visible in the textarea; editable.
3. Tap **Inietta** → `normalizePaste(value)` → if non-null, `onPasteText(text)` →
   `term.paste(text)` → bracketed-paste → `onData` → ws → pty → Claude's prompt line.
4. Field clears and closes. User reviews in the terminal, presses `⏎` to actually send.
5. `×` at any point → close without injecting.

## Error handling

- Empty / whitespace-only value → `normalizePaste` returns `null` → no-op; field stays
  open so the user can retry or cancel.
- `termRef.current` is `null` (terminal torn down mid-interaction) → `?.paste` no-ops.
- Non-text clipboard (e.g. an image) → textarea value stays empty → treated as empty.

## Testing

- **Unit (vitest):** `normalizePaste` — non-empty returns the value; empty and
  whitespace-only return `null`; multi-line value is preserved verbatim.
- **Manual (required, not automatable here):** on iOS Safari over the LAN IP —
  tap `📋`, long-press → Incolla, confirm the text appears in the field, tap Inietta,
  confirm it lands in Claude's prompt line (multi-line preserved, not auto-submitted),
  and that `×` cancels cleanly.

## Out of scope

- New-ticket image paste on mobile (existing "Add image" → Photos flow covers it).
- Serving the app over HTTPS / enabling `navigator.clipboard`.
