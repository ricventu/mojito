# Markdown document viewer

## Problem

A lime session writes its spec and plan as markdown files inside the ticket's worktree
(`docs/superpowers/specs/…`, `docs/superpowers/plans/…`, or nested one level down in a
monorepo, e.g. `web/docs/superpowers/specs/…`). It then reports the path in the terminal
and stops, waiting for the user to review it.

From a phone that report is a dead end. The path is not a link, the file lives in a
worktree the phone cannot browse, and reading a 300-line spec by scrolling a tmux pane
through xterm is unusable. The user needs to read those documents rendered, from Mojito,
without leaving the app.

## Scope

Read-only viewing of markdown files that belong to a session's or a ticket's worktree.
No editing, no creation, no serving of arbitrary repo files.

## What gets listed

Two sources, unioned:

1. **Superpowers docs** — a recursive scan of the worktree for directories matching
   `docs/superpowers/specs` and `docs/superpowers/plans`, so a monorepo's
   `web/docs/superpowers/specs/…` is found as well as a root-level one. The walk stops at
   depth 6 and never leaves the worktree it was given:

   - `node_modules` is skipped.
   - Every directory whose name begins with `.` is skipped. This is what keeps a worktree's
     list to its own documents: lime nests its worktrees under `.claude/worktrees/<ticket>/`,
     which sits at depth 3 and would otherwise be walked into. Measured on this repo, scanning
     the main checkout returned 175 documents, 115 of them the sibling worktrees' copies of the
     same specs. The rule also subsumes `.git`, `.next`, `.mojito` and `.superpowers`; no spec
     or plan ever lives under a dot-directory.
   - A nested git worktree or repository — any directory containing a `.git` entry — is not
     descended into, so a checkout parked under a plainly-named directory (`worktrees/`,
     `vendor/`) cannot leak its documents either.
2. **Markdown touched by the branch** — `git diff --name-only <base>...HEAD -- '*.md'`,
   with `<base>` from the existing `detectDefaultBranch` in `src/server/reviewScale.ts`.
   This catches anything the session wrote outside the superpowers folders.

The union is deduplicated by relative path and sorted by mtime, newest first. Each entry
carries a `source` of `specs`, `plans` or `branch`; a file that is both a spec and touched
by the branch keeps `specs` — the folder wins over the git origin.

Source 2 is best-effort. No git, no default branch, no commits on the branch, or a git
error all yield an empty list rather than a failure, so source 1 still shows. It reports
deleted files too, so a path that no longer exists on disk is dropped when the entry's
mtime and size are read.

## Server

### `src/server/docFiles.ts`

Pure logic plus an injectable `run`, following the shape of `src/server/reviewScale.ts`.

```ts
export interface DocEntry {
  path: string;            // relative to the worktree root
  name: string;            // basename
  source: "specs" | "plans" | "branch";
  mtime: string;           // ISO
  size: number;            // bytes
}

export function scanSuperpowersDocs(root: string): DocEntry[];
export function branchMdPaths(root: string, run?: Run): string[];
export function listDocs(root: string, run?: Run): DocEntry[];
export function resolveDocPath(root: string, rel: string): string | null;
```

`resolveDocPath` is the security boundary for the content endpoint:

- reject anything that is not a `.md` file (case-insensitive),
- reject absolute inputs and inputs containing `..`,
- `path.resolve(root, rel)` must equal `root` + separator + remainder — compared with the
  separator appended, so a sibling directory whose name merely starts with the root's name
  cannot pass,
- `realpath` the result and re-check containment, so a symlink pointing out of the
  worktree is rejected too,
- anything else → `null`, which the route turns into a 400.

### `src/server/ticketCwd.ts`

`defaultResolveCwd` in `src/server/launch.ts` already knows how a ticket becomes a
directory (`resolveRepoFromMap` on the team key + project, then `resolveWorktree ?? repo`)
but it is private to that module. It moves to `src/server/ticketCwd.ts` as
`resolveTicketCwd(projectsPath, ticket, projectName)`; `launch.ts` imports it. No
behaviour change — one place that owns the mapping, now that two callers need it.

### Routes

Both are GET, both read `tokenFromHeaders(req.headers, cfg.token)` like every other route,
and neither writes anything.

`GET /api/docs?session=<id>` or `GET /api/docs?ticket=RIC-162&project=<name>`

```json
{ "root": "/home/mojito/code/mojito-RIC-162", "files": [ /* DocEntry[] */ ] }
```

- unknown session → 404
- ticket that resolves to no repo → 409 `{ "error": "no worktree for this ticket" }`
- session with an empty `cwd` → 400, mirroring the paste-image route

`GET /api/docs/content?<same target>&path=<relative>`

```json
{ "path": "docs/superpowers/specs/2026-07-27-…-design.md", "content": "# …" }
```

- rejected path → 400
- file gone since the listing → 404
- larger than 512 KB → 413 `{ "error": "document too large" }` (real specs are under 50 KB)

## Client

### `src/components/DocsView.tsx`

A full-screen overlay (`position: fixed; inset: 0`) with two screens driven by internal
state `selected: string | null`:

- `null` → the list, fetched once when the overlay mounts. Each row shows the basename, then
  `source · relative mtime`. Tapping a row sets `selected`.
- otherwise → the rendered document, with a `↻` in the header that re-fetches (a spec can
  be rewritten while it is on screen).

The header's `‹` goes back to the list from a document, and calls `onClose()` from the
list.

```ts
type DocsTarget = { session: string } | { ticket: string; project: string | null };
// props: { token, target, label, onClose }
```

`label` is what the header shows next to `docs` — the ticket id, or the session title for
a custom session.

### `src/components/MarkdownDoc.tsx`

`react-markdown` + `remark-gfm`, loaded through `next/dynamic({ ssr: false })` the way
`page.tsx` already loads `TerminalView`, so the parser is fetched the first time a document
opens rather than on first paint over Tailscale. Raw HTML in the markdown is not rendered
(react-markdown's default), so there is no `dangerouslySetInnerHTML` and no sanitizer to
maintain.

Links are treated by scheme. `http(s)` gets `target="_blank"` + `rel="noopener noreferrer"`,
matching what the terminal's WebLinksAddon does. `mailto:` stays a plain link. Anything else —
a relative path, a bare `#anchor`, a missing href — renders inert: relative `.md` navigation is
out of scope (below), and letting the browser follow such a link would leave the single-page app
for a 404, tearing down the live terminal WebSocket behind the viewer.

### `src/lib/useDocs.ts`

Fetches the listing for a target and the content for a path via `apiFetch`, exposing
`loading` and `error` for both.

### `src/lib/relativeTime.ts`

`"14:21"` for today, `"yesterday"`, `"3 days"`, `"12 Jul"` beyond a week. Pure, so it is
unit-tested directly.

### Styles — `src/app/globals.css`

`.docs-root`, `.docs-item`, and the markdown element styles under `.doc-body`: `h1`–`h4`,
`p`, `ul/ol`, inline `code`, `pre` with `overflow-x: auto`, `table` in a scrollable
wrapper, `blockquote`. Line height and measure tuned for phone reading; the existing
palette and chip styles are reused, and the page body never scrolls horizontally.

## Entry points

- **`TerminalView`** — a `📄` button (`aria-label="Documents"`) in `.term-head`, left of the
  `auto:` chip. `DocsView` renders *inside* `TerminalView`, so the terminal stays mounted
  underneath: the WebSocket is never closed and there is no scrollback replay on return.
  The header is already hidden while the keyboard is up, so the button follows it.
- **`SessionList`** — a `Docs` button (`btn ghost sm`) in the card's bottom row next to
  `Open`.
- **`LaunchSheet`** — a `Docs` button (`btn ghost block`) at the end of the sheet, for
  reading a ticket's spec when no session is alive (auto-advance retires sessions; the
  worktree outlives them). It closes the sheet and opens the overlay through new state in
  `page.tsx`, where there is no terminal to preserve.

The button is always present. When the worktree has no markdown the list says
"No documents yet." — cheaper than pre-counting files for every card in the list.

## Error handling

Every failure is a line of text in the list or the document, never a blank screen:

| Case | Shown |
| --- | --- |
| Ticket resolves to no repo | "No worktree for this ticket." |
| Worktree has no markdown | "No documents yet." |
| File gone between listing and open | "Document not found." with `‹` back to the list |
| Over the size cap | "Document too large to display." |
| Fetch failed / 401 | "Could not load documents." |

## Out of scope (v1)

Relative `.md` links navigating inside the viewer, local images (there is no static file
serving for worktree assets), syntax highlighting, and any form of editing.

## Testing

- `tests/server/docFiles.test.ts` — against a temporary directory: nested discovery
  (`web/docs/superpowers/specs`), `node_modules` exclusion, union/dedup/ordering and the
  `specs`-wins-over-`branch` rule, `branchMdPaths` with a fake `run` (no default branch, git
  throwing, empty output), and `resolveDocPath` rejecting `..`, absolute paths, a symlink
  escaping the root, and non-`.md` files.
- `tests/client/relativeTime.test.ts` — the today / yesterday / days / date thresholds.
- Routes stay thin enough that the logic under test lives in `docFiles.ts`, matching how the
  existing routes are covered.
- `npx tsc --noEmit && npx vitest run` must pass before the work is called done.

## Dependencies

`react-markdown` and `remark-gfm`, both runtime dependencies.
