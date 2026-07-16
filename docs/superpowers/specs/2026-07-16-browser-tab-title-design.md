# Browser tab title while a ticket terminal is open (RIC-129)

## Problem

When a ticket's terminal is open in Mojito, the browser tab still shows the static
title `Mojito` (set in `src/app/layout.tsx`). With several tabs open the user cannot
tell which ticket a tab is showing. RIC-129: set the browser title to the ticket's id
and title while its terminal is open.

## Scope

- **In scope:** set `document.title` to `<ID> — <title>` while `TerminalView` is
  mounted (i.e. a session terminal is open); restore the previous title when it closes.
- **Out of scope (YAGNI):** the static `layout.tsx` metadata title; titles for the
  list/tab views; per-session-state titles (e.g. reflecting `needs-input`).

## Design

### Placement

A dedicated `useEffect` in `src/components/TerminalView.tsx`. `TerminalView` renders
only while a terminal is open (`page.tsx` gates it on the `open` session), so the
effect's mount/unmount lifecycle already matches "terminal open / closed". It mirrors
the existing style save/restore effect in the same component (which saves and restores
`html`/`body` overflow on mount/unmount):

```ts
useEffect(() => {
  const prev = document.title;
  document.title = terminalTabTitle(session);
  return () => { document.title = prev; };
}, [session.ticket, session.title]);
```

Capturing and restoring the *previous* `document.title` (rather than hardcoding
`"Mojito"`) keeps the component decoupled from the layout's chosen default and matches
the overflow effect's save/restore pattern. Depending on `[session.ticket,
session.title]` re-applies the title if the open session's fields change.

### Format

`<ID> — <title>` using an em dash, e.g.:

```
RIC-129 — title browser con ticket
```

No app-identity suffix. ID first so it stays visible when the tab is truncated.

### Pure formatter

Extract the string-building into a pure function so it is unit-testable, following the
repo convention that pure helpers live in `src/lib/` with tests under `tests/lib/`
(e.g. `orderTickets.ts` → `tests/lib/orderTickets.test.ts`).

`src/lib/terminalTabTitle.ts`:

```ts
import type { SessionMeta } from "@/server/types";

export function terminalTabTitle(session: SessionMeta): string {
  const id = session.ticket?.trim();
  const title = session.title?.trim();
  if (id && title) return `${id} — ${title}`;
  if (id) return id;
  if (title) return title;
  return "Mojito";
}
```

`session.title` can be `undefined` on sidecars persisted before the field was added
(documented on the `SessionMeta` type), so the helper trims/guards both fields rather
than assuming they are present.

### Behaviour table

| `session.ticket` | `session.title`         | Tab title                              |
|------------------|-------------------------|----------------------------------------|
| `RIC-129`        | `title browser con ticket` | `RIC-129 — title browser con ticket` |
| `RIC-129`        | missing / empty         | `RIC-129`                              |
| empty (custom)   | (empty)                 | `Mojito` (fallback)                    |

## Testing

- `tests/lib/terminalTabTitle.test.ts` — cover the four rows of the behaviour table
  (id + title, id only, title only, neither).
- The effect itself is a thin wrapper around the pure formatter and standard DOM API;
  no DOM/component test is added, consistent with how the repo tests pure logic and
  leaves thin client wiring untested.

## Files touched

- `src/lib/terminalTabTitle.ts` (new) — pure formatter.
- `src/components/TerminalView.tsx` — add the `document.title` effect.
- `tests/lib/terminalTabTitle.test.ts` (new) — unit tests.
