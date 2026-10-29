# Filters, favourites and the session sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Board filters in the url, server-stored favourite filter sets, and an unfiltered live-session sidebar on the board and the terminal (RIC-502).

**Architecture:** Pure logic in `apps/web/src/lib` (url codec, board filtering, favourites list ops, sidebar grouping, board-return memory), unit-tested in node; components and hooks are glue. Server: a `hidden` column on `sessions` behind `PATCH /api/sessions/:id`, and `favorites` as one more key of the existing `settings` table behind the existing partial `PUT /api/settings`, which now emits `settings.updated`.

**Tech Stack:** pnpm workspace; server Node 22 + Hono 4 + better-sqlite3; web React 19 + Vite + Tailwind 4 + shadcn/ui + react-router 8 + TanStack Query 5; zod 4; vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-filters-favourites-sidebar-design.md`

## Global Constraints

- Work only in `apps/` and `packages/` (and docs); never touch v1 (`src/`, `server.ts`, `tests/`).
- Everything in English: code, comments, copy, server messages.
- Only Tailwind utilities + shadcn components (`src/components/ui`); icons are lucide with `size`.
- Pure logic in `src/lib`, tested in node (no jsdom, no RTL). Components are glue.
- Every surface that touches a screen edge pays the matching `--sat/--sar/--sab/--sal` inset.
- Error bodies are `{ error }`. Migrations are TS modules exporting SQL, append-only.
- Tests never touch real tmux sessions.
- Commit messages: `feat(v2/…)`/`fix(v2/…)` style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `pnpm v2:test`, `pnpm v2:typecheck`, `pnpm v2:build`; single file: `pnpm --filter @mojito/web exec vitest run test/lib/<file>` (server: `--filter @mojito/server`). Check the exact package names in `apps/*/package.json` before the first run.

## Review Focus

1. **Project names with url-special characters** (`R&D`, `a=b`, `c+d`, `Città nuova`) must round-trip through the url and a favourite unchanged → Task 3 test `round-trips awkward project names`.
2. **Typing a multi-word search**: the space between words must survive while typing (the url is not trimmed), yet `"foo "` and `"foo"` are the same favourite → Task 3 tests `keeps q's spaces in the live url` and `canonicalSearch trims q`.
3. **A hook state change after hiding** (Stop → idle, Notification → needs-input) must not un-hide the row → Task 1 test `a state patch keeps hidden`.
4. **A favourite naming a project that is no longer configured** must still be untickable in the sheet and yield an empty board with Clear, not a crash → Task 4 test `a selected unknown project matches nothing` and Task 3 test `sheetProjects keeps selected unknown projects`.
5. **A live session whose project left the configuration** must still be in the sidebar (General), never dropped → Task 6 test `an unmapped project goes to General`.

---

### Task 1: `hidden` on sessions (shared + server)

**Files:**
- Create: `apps/server/src/db/migrations/003_session_hidden.ts`
- Modify: `apps/server/src/db/migrations/index.ts`, `apps/server/src/db/sessions.ts`, `apps/server/src/sessions/launch.ts` (the three `SessionMeta` literals), `apps/server/src/sessions/reconcile.ts:~60` (adopted meta), `apps/server/src/http/routes/sessions.ts`, `packages/shared/src/types.ts`, `packages/shared/src/api.ts`
- Modify (fixtures): `apps/server/test/http/setup.ts` `meta()`, any other `SessionMeta` literal in server/web tests (typecheck finds them)
- Test: `apps/server/test/db/db.test.ts`, `apps/server/test/http/sessions.test.ts`, `apps/server/test/sessions/launch.test.ts`

**Interfaces:**
- Produces: `SessionMeta.hidden: boolean`; `SessionPatchBody = z.strictObject({ hidden: z.boolean() })` exported from `@mojito/shared`; `SessionsRepo.patch(id, p)` accepting `hidden`; `PATCH /api/sessions/:id` → 200 `SessionMeta` | 404 `{error}` | 400 `{error}`, emits `{ type: "session.updated", session }`.

- [ ] **Step 1: Write the failing tests**

`db.test.ts`: update the migrations assertion to `[{version:1},{version:2},{version:3}]`; add `it("adds hidden, defaulting to 0")` — `PRAGMA table_info(sessions)` contains `hidden` with `notnull` 1 and `dflt_value` `'0'`.

`sessions.test.ts`, new `describe("PATCH /api/sessions/:id")`:
- `hides and unhides a session` — insert `meta()`, PATCH `{hidden:true}` → 200, body `.hidden === true`, `sessions.get("mj-RIC-1")?.hidden === true`, `events` contains `{type:"session.updated", session: expect.objectContaining({id:"mj-RIC-1", hidden:true})}`; PATCH `{hidden:false}` → `hidden === false`.
- `404s an unknown id` — `res.status === 404`, body has `error`.
- `refuses any other body` — `{hidden:"yes"}` → 400; `{hidden:true, state:"ended"}` → 400; row unchanged.
- `a state patch keeps hidden` — insert, PATCH hidden true, then `sessions.patch(id, {state:"idle"})` → `get(id).hidden === true`.

`launch.test.ts`: `a relaunch shows a hidden session again` — insert an `ended` row for the ticket with `hidden: true`, launch the ticket (use the file's existing launch helpers), assert the new row `hidden === false`.

- [ ] **Step 2: Run them, expect FAIL** (`hidden` unknown / 404 route missing).

- [ ] **Step 3: Implement**

- Migration SQL: `ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;` with a one-line comment; register `{ version: 3, sql: sessionHidden }`.
- `types.ts`: `hidden: boolean` on `SessionMeta`, doc comment: "Sidebar-only: tucked into the sidebar's Hidden footer. Nothing behavioural reads it."
- `sessions.ts`: `hidden: number` on `Row`, `hidden: r.hidden === 1` in `toMeta`, `hidden` column in `insert` (`m.hidden ? 1 : 0`), `patch` accepts `"hidden"`.
- Every `SessionMeta` literal in `launch.ts` and `reconcile.ts` sets `hidden: false`.
- `api.ts`: `SessionPatchBody`.
- Route: `.patch("/sessions/:id", …)` — 404 when `!deps.sessions.get(id)`, `parseBody(c, SessionPatchBody)` → 400, `deps.sessions.patch(id, { hidden })`, emit, `c.json(session)`.
- Add `hidden: false` to every test fixture `SessionMeta`.

- [ ] **Step 4: Run** `pnpm v2:test` and `pnpm v2:typecheck` — PASS.

- [ ] **Step 5: Commit** `feat(v2/server): a session can be hidden from the sidebar (RIC-502)`

---

### Task 2: favourites in settings + `settings.updated` (shared + server)

**Files:**
- Modify: `packages/shared/src/types.ts`, `packages/shared/src/api.ts`, `packages/shared/src/events.ts`, `apps/server/src/db/settings.ts`, `apps/server/src/http/routes/settings.ts`
- Test: `apps/server/test/http/settings.test.ts`

**Interfaces:**
- Produces: `interface Favorite { name: string; search: string }`; `Settings.favorites: Favorite[]` (default `[]`); `FavoritesBody` (zod, exported); `SettingsBody.favorites?: Favorite[]`; event `{ type: "settings.updated" }` emitted by every successful `PUT /api/settings`.

- [ ] **Step 1: Write the failing tests** in `settings.test.ts`:
- `answers no favourites on a fresh database` — `body.favorites` equals `[]`.
- `stores favourites and leaves the other keys alone` — PUT statusDefaults, then PUT `{favorites:[{name:"Mojito",search:"project=mojito"}]}` → 200; `settings.get().favorites` equals that list; `statusDefaults.Todo` unchanged; prompts unchanged.
- `trims favourite names` — PUT `[{name:"  Mine ", search:""}]` → stored name `"Mine"`.
- `refuses duplicate names, ignoring case` — `[{name:"A",search:""},{name:"a",search:"q=x"}]` → 400, nothing stored.
- `refuses an empty name, a 61-character name, a 2001-character search, and 51 favourites` — `it.each`, each → 400.
- `emits settings.updated on a successful PUT only` — after a 200 PUT `events` contains `{type:"settings.updated"}`; after a 400 PUT the count is unchanged.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

- `FavoritesBody = z.array(z.object({ name: z.string().trim().min(1).max(60), search: z.string().max(2000) })).max(50).superRefine(…)` — duplicate `name.toLowerCase()` → issue `"duplicate favourite name: <name>"`.
- `SettingsBody` gains `favorites: FavoritesBody.optional()`.
- `defaultSettings()` gains `favorites: []`; `get()` reads key `favorites` and keeps it only when `FavoritesBody.safeParse` succeeds (a corrupt row reads as `[]`); `set()` writes it when present.
- `MojitoEvent` gains `| { type: "settings.updated" }`; the PUT route emits it after `set`.

- [ ] **Step 4: Run** server tests + typecheck — PASS.

- [ ] **Step 5: Commit** `feat(v2/server): favourite filter sets live in settings (RIC-502)`

---

### Task 3: url filter codec (`lib/filters.ts`)

**Files:**
- Create: `apps/web/src/lib/filters.ts`
- Test: `apps/web/test/lib/filters.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FILTER_STATUSES = ["In Review", "In Progress", "Todo", "Backlog"] as const;
  export interface BoardFilters { projects: string[]; statuses: string[]; q: string }
  export const NO_FILTERS: BoardFilters;
  export function parseFilters(params: URLSearchParams): BoardFilters;
  export function filterSearch(f: BoardFilters): string;     // live url, no "?", "" when unfiltered
  export function canonicalSearch(f: BoardFilters): string;  // filterSearch with q trimmed
  export function isFiltered(f: BoardFilters): boolean;      // projects, statuses or a non-blank q
  export function filterCount(f: BoardFilters): number;      // projects.length + statuses.length
  export function sheetProjects(configured: string[], selected: string[]): string[]; // union, sorted
  ```

- [ ] **Step 1: Write the failing tests**
- `parses repeated project and status` — `parseFilters(new URLSearchParams("project=b&project=a&status=Todo&q=x"))` → `{projects:["b","a"]…}` (order normalised by filterSearch, not by parse, or both — pick one and assert it; recommended: parse dedups and sorts too, so `projects:["a","b"]`).
- `drops unknown parameters and statuses` — `"doc=1&status=Done&status=Todo"` → `{projects:[],statuses:["Todo"],q:""}`.
- `writes the canonical order` — `filterSearch({projects:["b","a","a"],statuses:["Backlog","In Review"],q:"x"})` → `"project=a&project=b&status=In+Review&status=Backlog&q=x"`.
- `omits defaults` — `filterSearch(NO_FILTERS) === ""`; `filterSearch({...NO_FILTERS, q:"   "}) === ""`.
- `keeps q's spaces in the live url` — `parseFilters(new URLSearchParams(filterSearch({...NO_FILTERS,q:"foo "}))).q === "foo "`.
- `canonicalSearch trims q` — `canonicalSearch({...NO_FILTERS,q:" foo "}) === canonicalSearch({...NO_FILTERS,q:"foo"})`.
- `round-trips awkward project names` — for `["R&D","a=b","c+d","Città nuova"]`, `parseFilters(new URLSearchParams(filterSearch(f)))` deep-equals `f` (projects sorted).
- `isFiltered` — false for `NO_FILTERS` and a blank q; true for each axis alone.
- `filterCount` — `{projects:["a","b"],statuses:["Todo"],q:"x"}` → 3.
- `sheetProjects keeps selected unknown projects` — `sheetProjects(["b","a"],["z","a"])` → `["a","b","z"]`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** with `URLSearchParams.append`/`getAll`; projects sorted with `localeCompare`, statuses by `FILTER_STATUSES` index.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(v2/web): board filter url codec (RIC-502)`

---

### Task 4: filtering the board (`lib/board.ts`)

**Files:**
- Modify: `apps/web/src/lib/board.ts`
- Test: `apps/web/test/lib/board.test.ts`

**Interfaces:**
- Consumes: `BoardFilters`, `FILTER_STATUSES` (Task 3).
- Produces: `BoardSection.backlogOpen: boolean` (always `false` from `groupBoard`); `export function filterBoard(sections: BoardSection[], f: BoardFilters): BoardSection[]`.

- [ ] **Step 1: Write the failing tests** (reuse the file's `project`/`ticket`/`session` builders; `session()` gains `hidden: false`):
- `no filters change nothing` — `filterBoard(s, NO_FILTERS)` deep-equals `s`.
- `a project filter keeps only those sections and drops General` — sections Alpha, Beta, General; `projects:["Beta"]` → only Beta.
- `a selected unknown project matches nothing` — `projects:["Gone"]` → `[]`.
- `a status filter keeps only those tickets, ORed` — Alpha with In Review, Todo, In Progress; `statuses:["Todo","In Review"]` → active is the In Review and the Todo ticket.
- `a status filter hides other statuses and loose sessions` — a ticket `"QA"` and a loose session are gone under `statuses:["Todo"]`.
- `the Backlog group shows only with no status or Backlog selected` — `statuses:["Todo"]` → `backlog: []`; `statuses:["Backlog"]` → backlog kept, `backlogOpen: true`, active empty.
- `a search matches identifier, title and labels, case-insensitively` — q `"ric-2"`, `"TITLE ric-3"`, a label `"Bug"` with q `"bug"`.
- `a search trims q` — q `"  ric-2 "` matches RIC-2.
- `a search opens a Backlog group with a match` — Backlog ticket matching q → `backlogOpen: true`; a section whose backlog has no match → `backlog: []`.
- `a search matches loose sessions by ticket, id or kind` — q `"shell"` keeps a shell loose session, drops a claude one.
- `sections left empty are dropped`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `filterBoard`: per section — drop when project filter excludes it (null section excluded by any project filter); `active` = tickets passing status (when statuses non-empty: `statuses.includes(statusName)`; Backlog never in `active`) and text; `backlog` = `[]` when statuses non-empty and lacks Backlog, else text-filtered; `loose` = `[]` when statuses non-empty, else text-filtered; `backlogOpen = backlog.length > 0 && (statuses.includes("Backlog") || q.trim() !== "")`; drop empty sections. `groupBoard` sets `backlogOpen: false`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(v2/web): filter the board by project, status and text (RIC-502)`

---

### Task 5: favourites list operations (`lib/favorites.ts`)

**Files:**
- Create: `apps/web/src/lib/favorites.ts`
- Test: `apps/web/test/lib/favorites.test.ts`

**Interfaces:**
- Consumes: `Favorite` from `@mojito/shared` (Task 2).
- Produces:
  ```ts
  export function addFavorite(list: Favorite[], name: string, search: string): { list: Favorite[]; replaced: boolean };
  export function renameRefusal(list: Favorite[], index: number, name: string): string | null;
  export function renameFavorite(list: Favorite[], index: number, name: string): Favorite[];
  export function moveFavorite(list: Favorite[], index: number, delta: -1 | 1): Favorite[];
  export function removeFavorite(list: Favorite[], index: number): Favorite[];
  export function activeFavorite(list: Favorite[], search: string): number;
  ```

- [ ] **Step 1: Write the failing tests**
- `adds at the end, name trimmed` → `replaced: false`.
- `a same-name save replaces in place, keeping position and stored name` — list `[A, Mojito, C]`, `addFavorite(list, "mojito", "q=x")` → index 1 is `{name:"Mojito",search:"q=x"}`, `replaced: true`.
- `renameRefusal` — `""`/`"  "` → `"Name required"`; another entry's name in any case → `"A favourite with this name already exists"`; the entry's own name re-capitalised → `null`.
- `renameFavorite trims`.
- `moveFavorite` — up/down swap; first up and last down return an equal list.
- `removeFavorite`.
- `activeFavorite` — index of the equal `search`, `-1` for none and for `""` (the bare board is never a favourite).

- [ ] **Step 2–4:** run (FAIL) → implement (no mutation of the input) → run (PASS).
- [ ] **Step 5: Commit** `feat(v2/web): favourite list operations (RIC-502)`

---

### Task 6: sidebar model and board-return memory (`lib/sidebar.ts`, `lib/boardReturn.ts`)

**Files:**
- Create: `apps/web/src/lib/sidebar.ts`, `apps/web/src/lib/boardReturn.ts`
- Test: `apps/web/test/lib/sidebar.test.ts`, `apps/web/test/lib/boardReturn.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // sidebar.ts
  export interface SidebarGroup { project: string | null; sessions: SessionMeta[] }
  export function sidebarGroups(projects: ProjectRow[], sessions: SessionMeta[]): SidebarGroup[];
  export function splitHidden(groups: SidebarGroup[]): { shown: SidebarGroup[]; hidden: SidebarGroup[] };
  export function sessionLabel(s: SessionMeta, tickets: TicketSummary[]): { primary: string; secondary: string };
  // boardReturn.ts
  export const BOARD_SEARCH_KEY = "mojito2-board-search";
  export function rememberBoardSearch(search: string, store?: Storage | null): void;
  export function boardHref(store?: Storage | null): string;
  ```
  `store` defaults to `sessionStorage` when it exists (guarded `typeof sessionStorage`), else no-op / `"/"`.

- [ ] **Step 1: Write the failing tests**

`sidebar.test.ts`:
- `excludes ended sessions`.
- `groups configured projects alphabetically, General last`.
- `an unmapped project goes to General` — project `"Gone"` not in `projects` → group `null`.
- `orders a group newest first, ties by id`.
- `a state change does not move a row` — same input with one session's `state` flipped to `needs-input` → identical id order.
- `splitHidden keeps the grouping and drops empty groups`.
- `sessionLabel` — ticket session with the ticket in the list → `{primary:"RIC-5", secondary:"title RIC-5"}`; ticket not in the list → secondary `""`; claude `mj-mojito-a1b2c3` → `{primary:"Claude", secondary:"a1b2c3"}`; shell → `"Shell"`.

`boardReturn.test.ts` (fake `Storage` as a `Map`-backed object):
- `"/" when nothing is remembered`; `remembers and returns "/?<search>"`; `"" is remembered as "/"`; `a store that throws on get/set gives "/" and does not throw`; `null store gives "/"`.

- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(v2/web): sidebar model and board-return memory (RIC-502)`

---

### Task 7: filter + favourites UI on the board

**Files:**
- Create: `apps/web/src/hooks/useBoardFilters.ts`, `apps/web/src/hooks/useFavorites.ts`, `apps/web/src/components/board/FilterBar.tsx`, `apps/web/src/components/board/FilterSheet.tsx`, `apps/web/src/components/board/FavoriteChips.tsx`
- Modify: `apps/web/src/components/board/Board.tsx`, `apps/web/src/components/board/Toolbar.tsx` (a `children` slot rendered under its row, inside the sticky container), `apps/web/src/components/board/ProjectSection.tsx` (Backlog Collapsible `key={String(section.backlogOpen)}` + `defaultOpen={section.backlogOpen}`), `apps/web/src/hooks/useEvents.ts` (`settings.updated` → invalidate `qk.settings`), `apps/web/src/components/terminal/TerminalPage.tsx` (Board links + kill → `boardHref()`), `apps/web/src/components/settings/SettingsPage.tsx` (Board link → `boardHref()`)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:
  ```ts
  export function useBoardFilters(): [BoardFilters, (next: BoardFilters) => void]; // replace: true; writes rememberBoardSearch(filterSearch(next)) on every change and on mount
  export function useFavorites(): { favorites: Favorite[]; save(next: Favorite[]): void };
  ```
  `useFavorites.save`: `qc.setQueryData<Settings>(qk.settings, (s) => s && { ...s, favorites: next })`, then `apiJson("/api/settings","PUT",{favorites: next})`; on error `toast.error(message)` + `invalidateQueries(qk.settings)`.

- [ ] **Step 1: Build the components** per spec §1 UI and §2 UI:
  - `FilterBar`: `Input` (placeholder `Search tickets…`, `type="search"`, a ghost ✕ button when `q` non-empty) + `Button variant="outline" size="sm"` `ListFilter` icon "Filter" with ` · n` when `filterCount > 0`; below, `FavoriteChips` when favourites exist.
  - `FilterSheet`: `Sheet`, `side` `"bottom"` below `sm` and `"right"` from `sm` (a `useMediaQuery("(min-width: 640px)")` or two classes — pick one), title "Filters"; Projects as native checkboxes (`sheetProjects`), Status as four `Button`s with `aria-pressed`; footer: "Clear" (disabled when `!isFiltered`) and "Save as favourite" (disabled when `!isFiltered`) revealing a name `Input` + Save; on save `addFavorite(favorites, name, canonicalSearch(filters))`, `save(list)`, `toast.success(replaced ? \`Updated ${name}\` : \`Saved ${name}\`)`. The sheet content pays `--sab` (bottom) / `--sat`+`--sar` (right).
  - `FavoriteChips`: `overflow-x-auto` row of `Button size="sm"` with `Star` icon, `variant` `default` when active else `outline`, `aria-pressed`; tap active → `setFilters(NO_FILTERS)`; tap other → `setFilters(parseFilters(new URLSearchParams(fav.search)))`.
  - `Board`: `const [filters, setFilters] = useBoardFilters()`; `filterBoard(groupBoard(…), filters)`; when the filtered list is empty and `isFiltered(filters)` → "Nothing matches these filters." + `Button` "Clear filters".

- [ ] **Step 2: Typecheck + full web tests** — `pnpm v2:typecheck && pnpm v2:test` PASS.

- [ ] **Step 3: Drive it** with `pnpm v2:dev` (use the `run` skill / claude-in-chrome if available; otherwise report what was not seen): type a two-word search (space survives), tick two projects (url has two `project=`), select Backlog (groups open), save a favourite, clear, tap the chip (filters return, chip highlighted), open a terminal, Board link returns to the filtered board, reload keeps the filters.

- [ ] **Step 4: Commit** `feat(v2/web): board filters and favourite chips (RIC-502)`

---

### Task 8: Favourites card in Settings

**Files:**
- Create: `apps/web/src/components/settings/FavoritesCard.tsx`
- Modify: `apps/web/src/components/settings/SettingsPage.tsx` (card after `ProjectsCard`; header doc comment lists it)

**Interfaces:**
- Consumes: `useFavorites` (Task 7), `renameRefusal`/`renameFavorite`/`moveFavorite`/`removeFavorite` (Task 5).

- [ ] **Step 1: Build the card**: `Card` titled "Favourites", description "Saved board filters, in the order the board shows them." One row per favourite: an `Input` with the name (commit on blur/Enter through `renameRefusal` → refusal text under the field in `text-destructive`, else `save(renameFavorite(…))`), `ArrowUp`/`ArrowDown` `icon-sm` buttons (disabled at the ends, `aria-label` "Move <name> up/down"), `Trash2` delete (`aria-label` "Delete <name>"). Empty list: "No favourites yet. Filter the board, then Save as favourite."
- [ ] **Step 2: Typecheck + tests** PASS; drive it: rename, collision message, re-capitalise allowed, reorder reflected on the board.
- [ ] **Step 3: Commit** `feat(v2/web): manage favourites in Settings (RIC-502)`

---

### Task 9: the session sidebar on the board and the terminal

**Files:**
- Create: `apps/web/src/hooks/useSidebar.ts`, `apps/web/src/components/sidebar/SessionSidebar.tsx`, `apps/web/src/components/sidebar/SidebarRow.tsx`
- Modify: `apps/web/src/components/board/Toolbar.tsx` (leading `PanelLeft` toggle, `aria-label="Sessions"`), `apps/web/src/components/board/Board.tsx`, `apps/web/src/components/terminal/TerminalPage.tsx`, `apps/web/test/safeArea.test.ts`

**Interfaces:**
- Consumes: `sidebarGroups`, `splitHidden`, `sessionLabel` (Task 6); `PATCH /api/sessions/:id` (Task 1).
- Produces:
  ```ts
  export const SIDEBAR_PIN_KEY = "mojito2-sidebar-pinned";
  export const SIDEBAR_DOCK_QUERY = "(min-width: 1024px)";
  export interface SidebarState {
    open: boolean; docked: boolean; canPin: boolean; pinned: boolean;
    toggle(): void;            // docked → closes and unpins; else flips open
    close(): void;
    setPinned(p: boolean): void; // unpinning leaves it open as an overlay
  }
  export function useSidebar(): SidebarState; // open initialised to pinned && canPin; docked = open && pinned && canPin
  // SessionSidebar props
  { sidebar: SidebarState; currentId?: string; replace?: boolean; dockedClassName?: string }
  ```

- [ ] **Step 1: Write the failing safe-area test** — add to the `it.each`: `["src/components/sidebar/SessionSidebar.tsx", "var(--sat)"]`, `["src/components/sidebar/SessionSidebar.tsx", "var(--sal)"]`, `["src/components/sidebar/SessionSidebar.tsx", "var(--sab)"]`. Run → FAIL (file missing).

- [ ] **Step 2: Build**
  - `useSidebar`: `localStorage` read in the `useState` initialiser, every access in try/catch; `matchMedia(SIDEBAR_DOCK_QUERY)` with a change listener.
  - `SidebarRow`: `<li>` with a `button` (navigate `/session/<id>`, `{ replace }`), a state dot (`size-2 rounded-full`; amber for `needs-input`, emerald running, sky starting, muted idle), `primary` (mono when ticket) and truncated `secondary`, `aria-current="page"` + `bg-accent` when current; a sibling ghost `icon-sm` `EyeOff`/`Eye` button, `aria-label` "Hide <primary>"/"Show <primary>".
  - Hide mutation (in `SessionSidebar`): optimistic `setQueryData<SessionMeta[]>(qk.sessions, …)` flipping `hidden`, `apiJson(\`/api/sessions/${id}\`, "PATCH", { hidden })`; on error `toast.error` + invalidate `qk.sessions`.
  - `SessionSidebar`: header "Sessions" + pin button (`Pin`/`PinOff`, only when `canPin`) + close ✕; the grouped list (group heading = project or "General"); empty → "No live sessions"; footer when any hidden: `EyeOff` "Hidden (n)" toggle (amber text when a hidden session is `needs-input`) expanding the hidden groups at the end. Picking a row calls `sidebar.close()` unless docked. Docked: `<aside className={cn("flex w-72 shrink-0 flex-col border-r bg-background", dockedClassName)}>`; otherwise `<Sheet open={sidebar.open} onOpenChange={(o) => !o && sidebar.close()}>` `<SheetContent side="left" className="w-72 … pt-[var(--sat)] pl-[var(--sal)] pb-[var(--sab)]">`.
  - Board: `const sidebar = useSidebar()`; toggle in Toolbar; when `sidebar.docked` the root gets `pl-72` and `SessionSidebar` with `dockedClassName="fixed inset-y-0 left-0 z-20 pt-[var(--sat)] pl-[var(--sal)] pb-[var(--sab)]"`; rows push.
  - Terminal: root `flex-col` → `flex-row`; the existing column content moves into `<div className="flex min-w-0 flex-1 flex-col">`; `PanelLeft` toggle first in the header; `SessionSidebar` with `currentId={id}`, `replace`, `dockedClassName="pointer-coarse:pb-[var(--sab)]"`, not rendered docked while `band.open`. No width transitions.

- [ ] **Step 3: Run** safe-area test + `pnpm v2:test && pnpm v2:typecheck` — PASS.

- [ ] **Step 4: Drive it**: overlay on a narrow window (pick closes it; Back from a terminal reached by switching returns to the board); ≥1024px pin docks on board and terminal, terminal re-fits once, unpin leaves an overlay, toggle on a docked one closes and unpins, reload keeps the pin; hide a row → Hidden (1) footer, unhide; hide on one tab shows hidden on another.

- [ ] **Step 5: Commit** `feat(v2/web): live sessions sidebar on the board and the terminal (RIC-502)`

---

### Task 10: docs and final verification

**Files:**
- Modify: `CLAUDE.md` (v2's): Server — `hidden` + `PATCH /api/sessions/:id`, `favorites` settings key + `settings.updated`; Web — filters in the url (`lib/filters.ts`, replace-only history, `canonicalSearch`), `filterBoard` and Backlog opening, favourites (chips + Settings card), `boardReturn` (sessionStorage), sidebar (unfiltered, immutable order, hide is sidebar-only, pin per browser ≥1024px docked, push from board / replace from terminal).

- [ ] **Step 1: Update CLAUDE.md** in the existing terse style.
- [ ] **Step 2: Run** `pnpm v2:test && pnpm v2:typecheck && pnpm v2:build` — all PASS (re-run the tmux integration test alone if it flakes).
- [ ] **Step 3: Commit** `docs(v2): filters, favourites and the session sidebar (RIC-502)`
