# Project folder picker (RIC-585)

## Intent

A project's Path (Settings → Projects → Add/Edit) is typed by hand today, `~/code/project`, and
only its shape is checked before Save; a wrong folder shows up as a 400 on Save. On the phone
typing a path is the clumsy part. The dialog gets a folder picker: browse the server's disk and
tap the repo folder.

## Goals

- Pick a project's folder without typing, on the phone as on the desktop.
- Show which folders are git repos, so the right one is obvious.

## Non-goals

- Browsing or reading files (folders only; the Docs page covers markdown).
- A repo scan or path autocomplete (approaches B and C below).
- Hidden folders: never listed (no toggle). A path into one can still be typed.
- Peers: Settings edits this instance only; no relay entry.

## Approaches

- **A. Browse step inside the dialog — picked.** A folder button beside Path switches the
  dialog to a folder list; tap to enter, `..` to go up, "Use this folder" to fill Path. Always
  works, no typing.
- B. Autocomplete under the Path field. Lighter, but still typing on the phone keyboard.
- C. A list of repos found by scanning HOME. One tap when it works, but a guess: deeper or
  unusual places are missing, so it needs A or typing as a fallback anyway.

## Design

**Server** — `GET /api/fs/dirs?path=` (token required, read-only):

- `path` absent → HOME. `~`/`~/…` expanded by `expandHome`; anything else must be absolute
  (else 400). Normalised (`resolve`), so `..` segments are fine.
- Answer `{ path, parent, home, dirs: [{ name, git }] }`: `path` the absolute folder, `parent`
  its parent (`null` at `/`), `home` the server's HOME (the client shows paths under it as `~`), `dirs` the subfolders sorted by name (case-insensitive, `en`), names
  starting with `.` left out. A symlink to a folder counts as a folder. `git` = the folder has a
  `.git` entry (directory, or a worktree's file).
- Not fenced to HOME: the token already opens a shell in every session (as the image viewer).
- Not a directory / not found → 404 `{error}`; unreadable (EACCES/EPERM) → 403 `{error}`. An
  unreadable or broken child is skipped, never fails the list.
- Types in `@mojito/shared`: `DirEntry`, `DirList`.

**Web** — `ProjectDialog`:

- A folder icon button beside the Path input switches the dialog body to the picker (same
  dialog, no nested modal; the form's fields are kept).
- Starts at the typed Path if any (the server resolves it); if that fails (404/403/400), falls
  back to HOME with the error shown above the list.
- Header: "Choose folder" and the current path shown with HOME as `~`. Rows: `..` (when there
  is a parent), then each folder with a `git` badge. Tap = enter.
- Footer: Cancel (back to the form, Path unchanged) and "Use this folder" (Path = current
  folder, HOME shown as `~/…`, back to the form).
- Pure logic in `src/lib` (the `~` display of a path), unit-tested in node.

## Left to the builder

Exact icons and copy, loading state, module layout on the server.
