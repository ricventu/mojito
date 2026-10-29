# Filters, favourites and the session sidebar (v2) — design

Ticket: RIC-502. Sub-project 1 of the v2 roadmap
(`2026-10-28-mojito-rewrite-core-design.md`, "Roadmap dei sotto-progetti successivi").

## Goal

Three needs v1 already met, redesigned for v2 (React Router, TanStack Query, SQLite):

- **Filters** on the board — project (multi-select), status, text — with the state in the url.
- **Favourites** — named filter sets, saved server-side, reorderable, one tap to apply.
- **Session sidebar** — the live sessions, on the board and on the terminal, unfiltered,
  grouped by project, with a per-row hide and a pin.

Built inside the current layout. The interface redesign (RIC-501) may move or restyle the
sidebar later; nothing here assumes the new layout.

Out of scope: an assignee ("Mine") filter, remembering the filter set across cold starts
(v1's RIC-272 — favourites make the usual set one tap away, and v2 has no PWA yet), drag
reordering.

## 1. Filters

### State

The url is the only place filter state lives:

```
/?project=mojito&project=sito&status=Todo&status=In%20Review&q=sidebar
```

`apps/web/src/lib/filters.ts` is the pure codec:

```ts
export const FILTER_STATUSES = ["In Review", "In Progress", "Todo", "Backlog"] as const;
export interface BoardFilters { projects: string[]; statuses: string[]; q: string }
export const NO_FILTERS: BoardFilters;
export function parseFilters(params: URLSearchParams): BoardFilters;
export function filterSearch(f: BoardFilters): string;    // the live url, no leading "?"
export function canonicalSearch(f: BoardFilters): string; // filterSearch with q trimmed
export function isFiltered(f: BoardFilters): boolean;
```

- `project` and `status` repeat, one parameter per value (a project name is free text: no
  separator is safe to join on).
- Canonical form: projects deduplicated and sorted by plain `sort()` (UTF-16 code units —
  never the device's locale, since favourites compare as strings across devices; display
  order elsewhere uses `localeCompare(b, "en")`), statuses deduplicated
  in `FILTER_STATUSES` order, empty values and defaults omitted (a whitespace-only `q`
  included), parameter order `project`, `status`, `q`. The unfiltered board is a bare `/`.
  `q` keeps its spaces in the live url — trimming it there would eat the space being typed
  between two words — and is trimmed by `canonicalSearch(f)`, the form favourites are saved
  in and compared by; matching trims it too.
- `parseFilters` drops unknown parameters and status values outside `FILTER_STATUSES`.
- Two filter sets are equal iff their `canonicalSearch` strings are equal.

`hooks/useBoardFilters.ts` is the glue: `useSearchParams` → `parseFilters`, and a setter that
writes `filterSearch` with `{ replace: true }`. Every filter change **replaces** the history
entry — Back leaves the board as it was entered rather than undoing one chip at a time.

### Applying

`filterBoard(sections, filters)` in `lib/board.ts`, a pure step after `groupBoard`:

- **project**: non-empty → only those projects' sections; the General section
  (`project: null`) is shown only when no project is selected.
- **status**: non-empty → a section's `active` tickets are restricted to the selected
  statuses (OR). Tickets in any status outside `FILTER_STATUSES` are shown only when no
  status is selected. Loose sessions have no status, so they are shown only when no status
  is selected.
- **q**: non-empty → tickets whose identifier, title or any label contains it
  (case-insensitive); loose sessions whose ticket, id or kind contains it.
- **Backlog**: the group stays as today (collapsed, `Backlog (n)`), and is shown only when no
  status is selected or Backlog is. `BoardSection` gains `backlogOpen: boolean`, true when
  Backlog is selected or `q` is non-empty (and the filtered backlog is non-empty). A search
  therefore never hides a Backlog match behind a closed group. `ProjectSection` keys the
  Collapsible on `backlogOpen` with `defaultOpen={backlogOpen}`, so the human can still
  toggle it.
- A section left with no ticket, backlog ticket or loose session is dropped.
- A filtered board with no section left shows "Nothing matches these filters" and a Clear
  button; an unfiltered empty board keeps today's "No tickets and no sessions."

### UI

Under the toolbar, one row:

```
[🔍 Search tickets…              ] [≡ Filter ·2]
(★ Mojito work) (★ Review) (★ Clienti)   →      ← only once a favourite exists
```

- The search field filters as you type (replace, as above), with a clear (✕) button when
  non-empty.
- **Filter** shows the count of selected projects + statuses when non-zero and opens the
  **filter sheet** (shadcn `Sheet`, `side="bottom"` on a phone, `side="right"` from `sm` up):
  - Projects: checkboxes. The list is the configured projects (`useProjects`) plus any
    selected project that is no longer configured, so a stale selection can be unticked.
  - Status: four toggle chips (`aria-pressed`), `FILTER_STATUSES`.
  - Footer: **Clear** (writes `NO_FILTERS`) and **Save as favourite** (§2).
  - Changes apply live; the sheet has no Apply button.

### Back to the board

The terminal's Board link and Kill's navigation go to `/` today, which would drop the
filters. `lib/boardReturn.ts` keeps the board's last search in `sessionStorage`
(`mojito2-board-search`) — per browser tab, so two tabs keep two filter sets:

```ts
export function rememberBoardSearch(search: string, store?: Storage | null): void;
export function boardHref(store?: Storage | null): string; // "/" or "/?<search>"
```

The board writes on every filter change; the terminal reads it for the Board link and
after a kill. Both are best effort: a store that throws (Safari private mode) means `/`.

## 2. Favourites

### Model and storage

```ts
// packages/shared
export interface Favorite { name: string; search: string }
```

`search` is a `canonicalSearch` string. Applying one navigates to `/?<search>`, which
goes through `parseFilters` like any url, so unknown parameters are dropped there: the
server validates shape only, never interprets it.

Stored as a new `favorites` key in the `settings` table. `Settings` gains
`favorites: Favorite[]` (default `[]`), and `SettingsBody` an optional `favorites`:

- at most 50 entries;
- `name` trimmed, 1–60 characters, unique case-insensitively (refined on the array);
- `search` at most 2000 characters.

`PUT /api/settings` is already partial — sending `{ favorites }` replaces only that key.
Every successful `PUT /api/settings` now emits a new event `{ type: "settings.updated" }`;
`eventCache` invalidates `qk.settings` on it, so a favourite saved on one device shows up on
an open board on another.

### Client

`lib/favorites.ts` (pure):

```ts
export function addFavorite(list: Favorite[], name: string, search: string): { list: Favorite[]; replaced: boolean };
// a case-insensitive name match replaces that entry in place (position and stored name kept)
export function renameRefusal(list: Favorite[], index: number, name: string): string | null;
// "Name required" | "A favourite with this name already exists" | null;
// re-capitalising the entry's own name is allowed
export function renameFavorite(list: Favorite[], index: number, name: string): Favorite[];
export function moveFavorite(list: Favorite[], index: number, delta: -1 | 1): Favorite[];
export function removeFavorite(list: Favorite[], index: number): Favorite[];
export function activeFavorite(list: Favorite[], search: string): number; // -1 when none
// the stored search is re-canonicalised before comparing, so any stored order matches
export function currentFavorites(cached: Favorite[] | undefined, queued: Favorite[][]): Favorite[] | undefined;
```

`hooks/useFavorites.ts` returns `{ favorites, ready, save }`:

- `ready` is true once settings have loaded. Until then nothing may write: the PUT replaces
  the whole list, so a write from an empty fallback would erase every saved favourite.
  "Save as favourite" is disabled and the Settings card shows no rows; `save` refuses too.
- `save(update: (current) => Favorite[])` computes the next list **at call time** from the
  current one, then queues `PUT { favorites }` in one mutation (`mutationKey` and
  `scope: { id: "favorites" }`), so the PUTs run one at a time and in order. It resolves
  `true` once the server has the list, `false` when nothing was sent or the PUT failed.
- The current list is `currentFavorites(cached, queued)`: the newest queued write, else the
  cached settings. The writes' variables are the optimistic state (`useMutationState`), so a
  settings refetch landing mid-queue — another write's `settings.updated`, a reconnect, a
  mount — can neither flash an older list nor become the base of the next write. A success
  writes the PUT's answer into `qk.settings`.
- On error a toast. Once the queue drains, `qk.settings` is invalidated (re-read, not a
  remembered rollback); while writes are queued, `settings.updated` does not invalidate it.

### UI

- **Board**: the chip row under the search row, horizontally scrolling, absent when the list
  is empty. The chip whose `search` equals the current `canonicalSearch` is highlighted
  (`aria-pressed`); tapping it again clears the filters, tapping another applies it.
- **Save**: "Save as favourite" in the filter sheet's footer, enabled only when
  `isFiltered` and settings have loaded. It reveals an inline name field + Save. A same-name
  save replaces that favourite in place and toasts "Updated <name>"; a new one toasts "Saved
  <name>" — once the PUT has succeeded, never before. A refused save keeps the typed name.
- **Manage**: a **Favourites** card in Settings (next to Projects): one row per favourite with
  its name (inline rename, at most 60 characters, refusal shown under the field), ↑ / ↓
  (disabled at the ends) and delete. An empty list says how to save one. Rows are keyed by
  position and a row's draft follows the name stored there, so a rename committed on blur
  and the ↑ tap that blurred it both land (each is an update of the list current when it is
  queued).

## 3. Session sidebar

### What it lists

`lib/sidebar.ts` (pure):

```ts
export interface SidebarGroup { project: string | null; sessions: SessionMeta[] }
export function sidebarGroups(projects: ProjectRow[], sessions: SessionMeta[]): SidebarGroup[];
export function splitHidden(groups: SidebarGroup[]): { shown: SidebarGroup[]; hidden: SidebarGroup[] };
```

- Every session whose state is not `ended` — `ended` is sticky, so a row never flickers in
  and out with a session's turns. Not filtered by the board.
- Grouped by project, configured projects alphabetically, then General (`null`, or a
  project no longer configured) last — the board's own section order.
- Within a group, newest `createdAt` first, ties by id. Every key is immutable for a
  session's life, so the list moves only on a launch or a removal; a session asking for
  input never jumps.
- `splitHidden` keeps the grouping in both halves; empty groups are dropped.

Row (`components/sidebar/SidebarRow.tsx`): a state dot (amber for `needs-input`), then the
ticket id + its title from the tickets cache, or `Claude`/`Shell` · the id's hex suffix;
highlighted (`aria-current`) when it is the terminal on screen. The hide button is a
**sibling** of the row's link, never nested in it.

### Hide

- Migration `003_session_hidden.ts`: `ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`.
- `SessionMeta.hidden: boolean`, mapped by the sessions repo. A launch writes a fresh meta
  (`INSERT OR REPLACE`) with `hidden: false`, so a relaunched session is visible again;
  reconcile's adoption also writes `false`; a revive keeps the row's value.
- `PATCH /api/sessions/:id`, body `SessionPatchBody = z.strictObject({ hidden: z.boolean() })`:
  404 for an unknown id, 400 for any other body, otherwise updates the column, emits
  `session.updated` and answers the session.
- Client: optimistic — the sessions query cache is patched (`setQueryData`, after cancelling an
  in-flight refetch); on error a toast says why and the list is re-read.
- Hidden rows leave the list for a footer toggle (`EyeOff` + "Hidden (n)") that lists them
  again at the end, each with an unhide button. The footer takes the amber colour while a
  hidden session needs input.
- Sidebar-only: the board, the waiting pill and Kill ignore `hidden`.

### Showing it

- A `PanelLeft` toggle in the board toolbar and in the terminal header, always offered; an
  empty list says "No live sessions".
- **Unpinned**: a shadcn `Sheet` from the left — an overlay, so the pty is never resized for
  a peek. Closes on picking a row, the backdrop, its ✕ or Escape (focus is in the sheet
  while it is open, so Escape is not claude's).
- **Pinned**: a docked `w-72` column, offered only at ≥ 1024px (`matchMedia`); below that the
  pin control is not rendered and a remembered pin is ignored: a docked sidebar closes when the
  viewport drops below the breakpoint (keeping its pin) and re-docks when it comes back. The
  pin button lives in the sidebar's header. Leaving a docked sidebar — unpin, its ✕ or the
  toolbar toggle — closes it **and drops the pin** (as in v1): a kept pin would re-dock it on
  the next open and on a reload. `hooks/useSidebar.ts` holds the open flag, the pin
  (`localStorage` `mojito2-sidebar-pinned`, read in the `useReducer` initialiser so a pinned
  sidebar docks on the first render, every access in try/catch) and the media query; the
  open/pin transitions are the pure `lib/sidebarState.ts`.
  - Board: the column is `fixed` on the left, the content gets the matching left padding.
  - Terminal: the root becomes a row (sidebar column + the current column); TerminalView's
    ResizeObserver re-fits once on dock/undock. No width transition: an animation would
    finish after the re-fit.
  - A docked sidebar is not rendered while the iOS keyboard is up (`band.open`).
- Every edge the sidebar touches pays its safe-area inset (`--sat`, `--sal`, `--sab`), in
  both arrangements.

### Navigation

A row is a link (`<Link>`, so Cmd/middle-click opens a new tab and iOS offers its long-press
menu); a plain click also closes the overlay. Picking a row from the board **pushes**
`/session/<id>` (Back returns to the board).
Picking one from a terminal **replaces** the entry, so Back keeps meaning "the board" however
many sessions were flipped through.

## 4. Errors

- A malformed url never breaks the board: `parseFilters` ignores what it does not know.
- Favourites save failure: toast + re-read. Hide failure: toast + override dropped.
- `localStorage`/`sessionStorage` unavailable: no remembered pin, Board link is `/`.

## 5. Testing

Node-only vitest, as everywhere in `lib`:

- `filters.test.ts`: round trip, canonical order, defaults omitted, unknown parameters and
  statuses dropped, repeated `project`, names containing `&`, `=`, spaces.
- `board.test.ts`: each filter alone and combined; General hidden by a project filter; loose
  sessions hidden by a status filter; other statuses hidden by a status filter; Backlog
  group shown/opened (Backlog selected, a search match inside); empty sections dropped.
- `favorites.test.ts`: case-insensitive replace in place; rename collision refused,
  re-capitalisation allowed; move at both ends; remove; `activeFavorite` (also a stored
  search in another order); `currentFavorites`.
- `sidebar.test.ts`: `ended` excluded; group order (alphabetical, General last, unmapped
  into General); order within a group; unchanged by a state change; `splitHidden` keeps
  grouping and drops empty groups.
- `boardReturn.test.ts`: write/read, a throwing store.
- Server: migration 003 on an existing database; `PATCH /api/sessions/:id` (hidden set,
  404, extra keys 400, event emitted); `PUT /api/settings { favorites }` (validation,
  duplicate names, `settings.updated` emitted, other keys untouched); relaunch resets
  `hidden`.
- `safeArea.test.ts` extended to the sidebar's edges.
