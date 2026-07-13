# Ticket title in session cards and terminal page — Design

**Ticket:** RIC-106 — "Titolo ticket in card sessions e pagina terminale"
**Date:** 2026-07-13

## Goal

Show the Linear ticket **title** in two places in the mojito-gui:

1. The session-list cards (the list of running/known sessions).
2. The individual session's terminal page.

Today both surfaces show only the ticket identifier (e.g. `RIC-106`) and the
launch status, not the human-readable title.

## Background

The title is **already carried end-to-end** — no data or server change is
required:

- `SessionMeta.title: string` — `src/server/types.ts:26` ("Linear ticket title
  at launch").
- Written at launch — `src/server/launch.ts:99` (`title: req.title`), persisted
  via the registry/sidecar.
- Served by `GET /api/sessions` — `src/app/api/sessions/route.ts` returns the
  full `SessionMeta[]`.
- Reaches the client via `useSessions` (`src/lib/useSessions.ts`) and is passed
  to both `<SessionList>` and `<TerminalView>` in `src/app/page.tsx`.

**Caveat (guard required):** `title` (and `labels`) were added after the
original sidecar schema. Sessions launched before that change may have `title`
`undefined` at runtime despite the non-optional type (see commit 1274d96). All
new rendering MUST be gated on a truthy `title`.

This makes the ticket a **UI-only** change in two components (plus CSS).

## Design

### 1. Session card — `src/components/SessionList.tsx`

Render the title on its own line directly below the identifier row and above
the launch status, mirroring the pre-launch `TicketList` layout.

- Insert after the id row (`:67-70`), before the status div (`:71`):
  ```jsx
  {s.title && <div className="session-title">{s.title}</div>}
  ```
- Use a **distinct** class `session-title` — NOT the existing `.title` class,
  which is already used at `:72` for the transient alert `message`. This avoids
  visual/semantic collision between the stable ticket title and the alert line.
- Add `s.title` to the search-filter fields (`:24-25`), so sessions can be
  filtered by title text alongside ticket/status/model/message.

### 2. Terminal page — `src/components/TerminalView.tsx`

Keep the single-row control header (`:102-114`) unchanged; add the full title
on a second line below it.

- Immediately after the closing `</header>` (`:114`), insert:
  ```jsx
  {session.title && <div className="term-title">{session.title}</div>}
  ```
- Full title on its own line — no truncation needed since it is not competing
  with the control row for horizontal space.

### 3. Styling — `src/app/globals.css`

- `.card .session-title` — title line in the card. Match the weight/size of the
  existing `.card .title` treatment (readable, slightly emphasized relative to
  the muted status), but as its own selector.
- `.term-title` — title line under the terminal header row. Sized to sit
  comfortably below `.term-head`, wrapping if long.

Exact values follow the existing globals.css scale; no new design tokens.

## Data flow

Unchanged. `title` already travels `SessionMeta` → API → `useSessions` →
`SessionList` / `TerminalView`. Only the two components' JSX and CSS change.

## Error handling

None required. The feature is purely presentational; a missing/empty title
renders nothing (the truthiness guard), and no code path can fail.

## Testing

- The existing suite (`npm test`, vitest) is server-side; there is no React
  component test harness in the repo. Adding one for a two-line JSX addition is
  out of scope (YAGNI).
- Verification is manual: launch a session with a ticket title and confirm the
  title shows on the session card and on the terminal page; confirm a session
  with no title (or an old sidecar) renders no empty title line.
- Keep `npm test` and `npm run typecheck` green.

## Out of scope

- Any server, API, sidecar, or `SessionMeta` change.
- Backfilling `title` onto old sidecars.
- A React component test harness.
