# Persist filter & search state (RIC-109)

## Problem

Mojito is a single-page client app (`src/app/page.tsx`) with two tabs — **Tickets**
and **Sessions**. The active tab, each list's project-chip filter, and each list's
search text are all held in component-local `useState`. Two things wipe that state:

1. **In-app navigation.** Opening a session makes `page.tsx` early-return
   `<TerminalView>` (`page.tsx:38`), unmounting both `TicketList` and `SessionList`.
   Returning remounts them fresh — filters and search are gone.
2. **Page reload.** Every `useState` resets to its default, so the app lands back on
   the Tickets tab with empty filters ("attualmente torna in elenco ticket").

Users expect the list to look the way they left it after either action.

## Goal

Persist and restore, across both in-app navigation and full page reloads:

- the **active tab** (`tickets` | `sessions`);
- the **Tickets** list's search text and project filter;
- the **Sessions** list's search text and project filter.

Tickets and Sessions keep **independent** filters — they are separate lists over
separate project sets.

## Non-goals

- Scroll position restoration (not requested).
- Cross-device / server-side persistence — this is a single-user localhost tool;
  browser-local storage is sufficient.
- URL/shareable state (rejected — see Alternatives).

## Approach

A small generic localStorage-backed hook, `usePersistedState`, used as a drop-in
replacement for the relevant `useState` calls. This mirrors the one persistence
pattern already in the codebase (`src/lib/useToken.ts`, which stores the token under
`mojito-token`) and adds no dependencies or routing machinery.

### New hook — `src/lib/usePersistedState.ts`

The pure read logic is extracted into `readPersisted` so it can be unit-tested in
the node test environment (see Testing) — mirroring how `useToken` delegates to the
tested pure `resolveInitialToken`. The hook itself is a thin, string-valued `useState`
replacement (callers store a tab id, a search string, or a project sentinel, so no
JSON serialization is needed).

```ts
"use client";
import { useState } from "react";

// Pure, testable: returns the stored string, or the fallback when the key is
// absent or storage is unavailable (SSR / no window).
export function readPersisted(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string,
  fallback: string,
): string {
  return storage?.getItem(key) ?? fallback;
}

export function usePersistedState(
  key: string,
  initial: string,
): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() =>
    readPersisted(typeof window === "undefined" ? undefined : window.localStorage, key, initial),
  );
  const set = (v: string) => {
    setValue(v);
    if (typeof window !== "undefined") window.localStorage.setItem(key, v);
  };
  return [value, set];
}
```

**Why a lazy synchronous initializer is safe here (no hydration mismatch, no flash).**
Next.js server-prerenders `page.tsx`, but with no token the render always returns
`<TokenGate>` (`page.tsx:34`). The token itself resolves from localStorage *after
mount* (`useToken` reads it in a `useEffect`), so the tab and both lists render only
on the client, after the gate opens. None of the persisted values ever appear in
server HTML, so reading localStorage synchronously in the initializer cannot produce
a hydration mismatch and shows no default-value flash.

### Wiring (5 persisted values)

All five values are strings, so the hook needs no generics or JSON.

| Location      | State     | Key                       | Default      |
|---------------|-----------|---------------------------|--------------|
| `page.tsx`    | `tab`     | `mojito-tab`              | `"tickets"`  |
| `TicketList`  | `query`   | `mojito-tickets-q`        | `""`         |
| `TicketList`  | `project` | `mojito-tickets-project`  | `""` (= All) |
| `SessionList` | `query`   | `mojito-sessions-q`       | `""`         |
| `SessionList` | `project` | `mojito-sessions-project` | `""` (= All) |

**Project sentinel.** The lists model "All" as `project === null`. The hook stores
strings, so each list maps at its own boundary: an empty string in storage means
`null` ("All"); any other string is the project name. This keeps a stored "All"
distinct from "never set" (both are `""` → `null`, which is the correct default) and
avoids threading `null` through the hook.

- `page.tsx`: replace `const [tab, setTab] = useState<"tickets" | "sessions">("tickets")`
  with `usePersistedState("mojito-tab", "tickets")`. `tab` stays typed as the union at
  the call site via a cast on read (the only two writers pass literal `"tickets"` /
  `"sessions"`).
- `TicketList` / `SessionList`: replace the `query` `useState` with the hook directly;
  replace the `project` `useState<string | null>(null)` with a `usePersistedState`
  string plus two thin adapters — read `stored === "" ? null : stored`, write
  `onProject(p) => set(p ?? "")`.

### Edge case — stale saved project

If a saved project name is no longer present in the live list (e.g. its tickets were
resolved/removed), the filter yields "No matching…". This is accepted, recoverable
behavior: the user clicks **All**. We deliberately do **not** auto-coerce a missing
project back to "All", because ticket/session data loads asynchronously (both hooks
start with an empty array) — coercing on an empty-during-load list would silently
discard the user's saved filter on every reload.

## Alternatives considered

- **URL query params.** Survives reload and is shareable, but there is no router-page
  model here (one client page), it would collide with `useToken`'s token-in-URL
  cleanup, and shareable state is worthless for a single-user localhost tool. More
  machinery, no real gain.
- **Lift state into `page.tsx` (in-memory).** Fixes the unmount-on-navigation loss but
  not reload, which the ticket explicitly requires. Insufficient alone.

## Testing

The vitest environment is **node** (`vitest.config.ts`) — no DOM, no
testing-library — so hooks are not rendered in tests. Following the codebase
convention (`resolveInitialToken` is tested; its `useToken` wrapper is not), the
pure `readPersisted` helper carries the tests, in `tests/lib/usePersistedState.test.ts`:

1. Returns the stored value when the key is present (fake `{ getItem }` storage).
2. Falls back to `initial` when the key is absent (`getItem` returns `null`).
3. Falls back to `initial` when storage is `undefined` (SSR / no-window guard) and
   does not throw.

The hook wrapper and the wiring in `page.tsx`, `TicketList`, and `SessionList` are
thin and mechanical (mirroring the untested `useToken`); `readPersisted` is the
logic-bearing unit and is where the tests concentrate. `npx tsc --noEmit && npx
vitest run` must stay green.
