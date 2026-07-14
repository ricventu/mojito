# Clickable terminal links (RIC-112)

## Problem

URLs printed inside the terminal view are shown as plain text and cannot be
clicked or tapped. The reported example is a GitLab merge-request URL (the kind
of link the lime lifecycle prints), but any `http(s)://` URL in the terminal
output is affected. Mojito is a mobile-first PWA, so a URL you can't tap is a
dead end — the user must retype it by hand.

Root cause: `src/components/TerminalView.tsx` builds an xterm.js `Terminal` and
loads only the `FitAddon`. Without a link addon, xterm renders URLs as ordinary
character cells with no link detection or click handling.

The terminal is the only surface in Mojito that renders arbitrary URLs, so the
fix is scoped to that component.

## Approach

Load xterm's official `@xterm/addon-web-links` (`WebLinksAddon`) alongside the
existing `FitAddon`. The addon scans rendered output for `http(s)://` URLs,
underlines them on hover/press, and invokes a handler on click/tap. This is the
standard xterm solution and mirrors the wiring already used for `FitAddon`.

Rejected alternatives:
- **Custom link provider** (`term.registerLinkProvider`): reimplements the
  addon's URL regex and click handling by hand — more code, no benefit here.
- **Links rendered outside the terminal** (parse output, show a separate
  clickable list): large change that breaks the raw-terminal model. Overkill.

## Design

Single-file change in `src/components/TerminalView.tsx`, plus one dependency.

- **Dependency:** add `@xterm/addon-web-links` at `^0.11.0` (compatible with the
  installed `@xterm/xterm@^5.5.0`).
- **Wiring:** in the setup `useEffect`, after the `FitAddon` is created and
  loaded, instantiate `WebLinksAddon` with a custom activation handler and
  `term.loadAddon(...)` it. No new effect and no new cleanup are needed — the
  existing `term.dispose()` in the effect's cleanup tears the addon down with the
  terminal.
- **Click behavior:** the activation handler opens the URL in a new tab via
  `window.open(uri, "_blank", "noopener,noreferrer")`. `noopener,noreferrer`
  prevents the opened page from accessing the Mojito window. This works for both
  desktop click and mobile tap.
- **Scope:** only `http(s)://` URLs (the addon's default matcher). No OSC-8
  hyperlink escape-sequence support is added — it isn't needed for the reported
  case and nothing in the pipeline emits it.

## Testing

This change is xterm/DOM wiring with no extractable business logic. The existing
test suite is server-only (`tests/server/`, run via `npx vitest run`) and does
not render React or xterm, so there is no meaningful unit test to add here —
adding one would only assert that a library method was called.

Verification is therefore:
1. **Automated (regression guard):** `npx tsc --noEmit && npx vitest run` stays
   green — the change type-checks and breaks nothing.
2. **Manual (behavioral):** in the running app, open a session whose terminal
   output contains an `http(s)://` URL (e.g. a lime-printed MR link), confirm the
   URL is underlined on hover/press and that clicking/tapping it opens the URL in
   a new browser tab.

The spec is explicit that automated behavioral coverage is not added, by design,
rather than implying full test coverage.

## Out of scope

- Making non-terminal UI text clickable (session cards, title bar) — the ticket
  is specifically about terminal output.
- OSC-8 hyperlink escape sequences.
- Custom link styling beyond the addon default.
