# Project Folder Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick a project's folder in Settings → Projects → Add/Edit by browsing the server's disk instead of typing the path.

**Architecture:** One read-only endpoint, `GET /api/fs/dirs?path=`, lists a folder's subfolders (real fs in `apps/server/src/fs/dirs.ts`, injectable into the route). The web `ProjectDialog` swaps its form for a `FolderPicker` view inside the same dialog; path helpers live in `apps/web/src/lib/folderPicker.ts`.

**Tech Stack:** Hono 4, node `fs/promises`, vitest; React 19, TanStack-free plain `apiFetch`, shadcn Dialog/Button/Badge, lucide icons.

**Spec:** `docs/superpowers/specs/2026-11-13-project-folder-picker-design.md`

## Global Constraints

- Hidden folders (name starting with `.`) are never listed.
- Not fenced to HOME; token required (every `/api/*` already is).
- Errors are `{ error }`: bad path 400, not a directory / missing 404, unreadable 403.
- Settings edits this instance only: no peer relay entry, no `hostApi`.
- Copy is English; Tailwind utilities + shadcn components only; lucide icons with `size`.
- Pure logic in `apps/web/src/lib`, unit-tested in node (no jsdom); components are glue.

## Review Focus

- A typed path with a trailing slash or `..` (`~/code/`, `~/code/../x`) → normalised by `resolve`, lists the right folder (Task 2 test).
- Folder names with spaces, `#`, `?`, `%`, non-ASCII → reach the server intact (`dirsHref` encodes; Task 3 test).
- A typed path that is a file or missing → 404, the picker falls back to HOME with the error shown (Task 1 test for 404 on a file; Task 4 behaviour).
- A broken symlink or an unreadable child in the listed folder → skipped, the list still answers (Task 1 test).
- The root `/` → `parent: null`, children are `/name` with no double slash (Task 1 and Task 3 tests).

---

### Task 1: Shared types + `listDirs` on the real filesystem

**Files:**
- Create: `packages/shared/src/fs.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./fs";`)
- Create: `apps/server/src/fs/dirs.ts`
- Test: `apps/server/test/fs/dirs.test.ts`

**Interfaces:**
- Produces (shared):
  ```ts
  /** One subfolder; `git` = it holds a `.git` entry (a repo, or a worktree's `.git` file). */
  export interface DirEntry { name: string; git: boolean }
  /** A folder's subfolders, sorted by name; `parent` null at `/`; `home` is the server's HOME. */
  export interface DirList { path: string; parent: string | null; home: string; dirs: DirEntry[] }
  ```
- Produces (server):
  ```ts
  export type DirListResult = { ok: true; list: DirList } | { ok: false; reason: "not-found" | "forbidden" };
  /** `path` absolute and already normalised. */
  export async function listDirs(path: string, home: string): Promise<DirListResult>
  ```

- [ ] **Step 1: Write the failing tests** in `apps/server/test/fs/dirs.test.ts`, each in a fresh `mkdtemp` dir (removed in `afterEach`):
  - `lists subfolders sorted case-insensitively, hidden ones and files left out`: create `b/`, `A/`, `c/`, `.hidden/`, `file.txt` → `dirs` names `["A", "b", "c"]`, `path` = the temp dir, `parent` = `dirname(tmp)`, `home` = the `home` argument.
  - `marks a folder holding .git, directory or file`: `repo/.git/` and `wt/.git` (a file) → both `git: true`, `plain/` → `git: false`.
  - `follows a symlink to a folder, skips a broken one`: `link -> repo` listed as `{ name: "link", git: true }`; `dead -> missing` absent.
  - `answers not-found for a missing path and for a file`: `listDirs(join(tmp, "nope"), …)` and `listDirs(join(tmp, "file.txt"), …)` → `{ ok: false, reason: "not-found" }`.
  - `answers forbidden for an unreadable folder` (skip with `it.skipIf(process.getuid?.() === 0)`): `chmod 000` a folder → `{ ok: false, reason: "forbidden" }`; restore mode before cleanup.
  - `skips an unreadable child without failing the list`: a `locked/` with mode 000 inside the listed folder still appears (it is a folder; `git` false), and the list is `ok`.
  - `gives the root no parent`: `listDirs("/", home)` → `ok`, `parent: null`.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @mojito/server exec vitest run test/fs/dirs.test.ts`
  Expected: FAIL, cannot resolve `../../src/fs/dirs`.

- [ ] **Step 3: Implement** the shared types, the index export, and `listDirs`.
  `readdir(path, { withFileTypes: true })`; ENOENT/ENOTDIR → `not-found`, EACCES/EPERM → `forbidden`, anything else rethrown. Keep entries not starting with `.` that are directories, or symlinks whose `stat` is a directory (a failing `stat` = skip). `git` = `lstat(join(child, ".git"))` succeeds (any failure = false). Sort with `a.name.localeCompare(b.name, "en", { sensitivity: "base" })`. `parent` = `dirname(path)`, null when equal to `path`.

- [ ] **Step 4: Run the tests**

  Run: `pnpm --filter @mojito/server exec vitest run test/fs/dirs.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/shared/src/fs.ts packages/shared/src/index.ts apps/server/src/fs/dirs.ts apps/server/test/fs/dirs.test.ts
  git commit -m "feat(server): list a folder's subfolders for the project folder picker (RIC-585)"
  ```

### Task 2: `GET /api/fs/dirs` route

**Files:**
- Create: `apps/server/src/http/routes/fs.ts`
- Modify: `apps/server/src/http/app.ts` (`AppDeps.listDirs?`, `app.route("/api", fsRoutes(deps))`)
- Test: `apps/server/test/http/fs.test.ts`

**Interfaces:**
- Consumes: `listDirs`, `DirListResult` (Task 1); `expandHome` (`src/homePath.ts`).
- Produces: `export function fsRoutes(deps: AppDeps): Hono`; `AppDeps.listDirs?(path: string): Promise<DirListResult>` — default `(p) => listDirs(p, deps.cfg.home)`.

- [ ] **Step 1: Write the failing tests** with `setup({ listDirs })` (a `vi.fn` returning `{ ok: true, list }`), `cfg.home` = `/home/me`:
  - `lists HOME when no path is given`: `GET /api/fs/dirs` and `?path=` → 200 with the list; `listDirs` called with `"/home/me"`.
  - `expands ~ and normalises`: `?path=~` → `"/home/me"`; `?path=~/code/` → `"/home/me/code"`; `?path=/a/b/../c` → `"/a/c"`.
  - `refuses a relative path or a NUL without listing`: `?path=code` → 400 `{ error: "path must be absolute: code" }`; `?path=%2Fa%00b` → 400 `{ error: "invalid path" }`; `listDirs` not called.
  - `404s a missing folder, 403s an unreadable one`: `{ ok: false, reason: "not-found" }` → 404 `{ error: "folder not found: /x" }`; `"forbidden"` → 403 `{ error: "folder not readable: /x" }`.
  - `needs the token`: no `x-mojito-token` → 401.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @mojito/server exec vitest run test/http/fs.test.ts`
  Expected: FAIL (404 from the `/api/*` fallback).

- [ ] **Step 3: Implement `fsRoutes`** and wire it in `createApp` after `projectRoutes`. Order: NUL check → `expandHome` → `isAbsolute` → `resolve` → `listDirs`. Doc comment: read-only, not fenced to HOME (the token already opens a shell), for the project folder picker.

- [ ] **Step 4: Run the server suite**

  Run: `pnpm --filter @mojito/server exec vitest run test/http test/fs`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/http/routes/fs.ts apps/server/src/http/app.ts apps/server/test/http/fs.test.ts
  git commit -m "feat(server): GET /api/fs/dirs for the project folder picker (RIC-585)"
  ```

### Task 3: Web path helpers

**Files:**
- Create: `apps/web/src/lib/folderPicker.ts`
- Test: `apps/web/test/lib/folderPicker.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** A path as the Path field shows it: HOME → "~", under HOME → "~/…", else unchanged. */
  export function tildePath(path: string, home: string): string
  /** The folder `name` inside `parent` (no double slash at "/"). */
  export function childPath(parent: string, name: string): string
  /** The endpoint for `path`; null or blank = HOME. */
  export function dirsHref(path: string | null): string
  ```

- [ ] **Step 1: Write the failing tests**
  - `tildePath("/home/me", "/home/me")` → `"~"`; `("/home/me/code/x", "/home/me")` → `"~/code/x"`; `("/home/meow", "/home/me")` → `"/home/meow"`; `("/srv/x", "/home/me")` → `"/srv/x"`.
  - `childPath("/", "etc")` → `"/etc"`; `childPath("/home/me", "a b")` → `"/home/me/a b"`.
  - `dirsHref(null)` and `dirsHref("  ")` → `"/api/fs/dirs"`; `dirsHref("~/a b#?%é")` → `"/api/fs/dirs?path=" + encodeURIComponent("~/a b#?%é")`; `dirsHref(" ~/x ")` trims → `?path=~%2Fx`.

- [ ] **Step 2: Run to see them fail**

  Run: `pnpm --filter @mojito/web exec vitest run test/lib/folderPicker.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the three functions.

- [ ] **Step 4: Run the tests**

  Run: `pnpm --filter @mojito/web exec vitest run test/lib/folderPicker.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/lib/folderPicker.ts apps/web/test/lib/folderPicker.test.ts
  git commit -m "feat(web): path helpers for the project folder picker (RIC-585)"
  ```

### Task 4: `FolderPicker` in the project dialog, docs

**Files:**
- Create: `apps/web/src/components/settings/FolderPicker.tsx`
- Modify: `apps/web/src/components/settings/ProjectDialog.tsx`
- Modify: `CLAUDE.md` (Server: a `Folder picker` bullet after Pull/Push-adjacent project bullets; Web: one line on `FolderPicker` / `lib/folderPicker.ts`)

**Interfaces:**
- Consumes: `DirList` (Task 1), `GET /api/fs/dirs` (Task 2), `tildePath`/`childPath`/`dirsHref` (Task 3), `apiFetch` (`lib/api.ts`).
- Produces: `export function FolderPicker(props: { start: string; onPick(path: string): void; onCancel(): void }): JSX.Element` — `onPick` receives the `tildePath` form.

- [ ] **Step 1: Implement `FolderPicker`.** Behaviour:
  - On mount loads `dirsHref(start)`. A failure with no list shown yet loads HOME (`dirsHref(null)`) and keeps the first error visible; a failure while a list is shown keeps that list and shows the error. Any successful load clears the error. A late answer for a superseded request is ignored.
  - `DialogHeader`: title "Choose folder", the current path (`tildePath`) in `font-mono text-xs`, `break-all`.
  - List (`max-h-[50vh] overflow-y-auto`, rows `min-h-11` full-width buttons, lucide `Folder`/`FolderGit2` size 16): `..` first when `parent` is non-null, then each dir with a `git` `Badge variant="secondary"`. Tap = load `childPath(list.path, name)` (or `parent`). "Loading…" / empty "No folders here." in `text-sm text-muted-foreground`; error in `role="alert" text-sm text-destructive`.
  - `DialogFooter`: Cancel (`variant="outline"`, `onCancel`) and "Use this folder" (disabled with no list, `onPick(tildePath(list.path, list.home))`).

- [ ] **Step 2: Wire it into `ProjectDialog`'s `Form`.** `const [browsing, setBrowsing] = useState(false)`. The Path row becomes the input plus an `icon` `variant="outline"` button (`FolderOpen` size 16, `aria-label="Browse folders"`, `type="button"`). While browsing, render `<FolderPicker start={path} …/>` instead of the `<form>`: `onPick` sets `path` and clears `error`, both callbacks set `browsing` false. Name and team key are kept (the `Form` stays mounted).

- [ ] **Step 3: Update `CLAUDE.md`** — Server bullet: `GET /api/fs/dirs?path` (`fs/dirs.ts`, `http/routes/fs.ts`): a folder's subfolders for the project folder picker, `~` expanded, normalised, hidden ones left out, `git` marks a `.git` entry, a broken/unreadable child skipped; 400 relative/NUL, 404 missing or not a folder, 403 unreadable; not fenced to HOME (the token opens a shell), not relayed to peers. Web: the Path field's Browse swaps the dialog body for `FolderPicker` (falls back to HOME when the typed path fails), writing the pick as `~/…` (`lib/folderPicker.ts`). Add `DirEntry`/`DirList` to the shared types list.

- [ ] **Step 4: Verify**

  Run: `pnpm test && pnpm typecheck`
  Expected: all pass.
  Then `pnpm dev`, open Settings → Projects → Add, Browse: starts at HOME, enter a repo (git badge), `..`, "Use this folder" fills `~/…`; Edit an existing project: starts at its folder; type `/nope` then Browse: error shown over HOME's list. Check at phone width (390px) too.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/web/src/components/settings/FolderPicker.tsx apps/web/src/components/settings/ProjectDialog.tsx CLAUDE.md docs/superpowers/specs/2026-11-13-project-folder-picker-design.md docs/superpowers/plans/2026-11-13-project-folder-picker.md
  git commit -m "feat(web): browse for a project's folder in Settings (RIC-585)"
  ```
