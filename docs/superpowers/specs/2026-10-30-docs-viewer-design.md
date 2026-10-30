# Docs viewer (v2) — design

Ticket: RIC-506. Sub-project 5 of the v2 roadmap
(`2026-10-28-mojito-rewrite-core-design.md`, "Roadmap dei sotto-progetti successivi").
v1 reference: `git show main:docs/superpowers/specs/2026-07-27-markdown-doc-viewer-design.md`.

## Goal

Read the markdown a session writes — specs, plans, notes — rendered, from a phone. The case
that matters: a session writes a spec, prints its path and stops for a review; reading 300
lines through xterm is unusable.

Success: from a terminal, one tap on the path claude printed opens the document rendered;
from a project header, a ticket sheet or a terminal header, one tap lists the project's
documents with the ticket's own on top; readable at 320px.

Out of scope: editing, creating, any file that is not markdown, a search field over the list,
rendering images or mermaid, in-page `#anchor` jumps, live refresh while reading.

### What changes from v1

- **One page per project**, like the git graph, instead of a session or ticket target. A
  ticket is a group on top of its project's list, not a target of its own.
- **No worktree root**: v2 creates no worktrees, and sessions run in the project checkout
  (`mj-RIC-506` has `cwd` `~/code/mojito-v2` and commits straight to `v2`). A ticket's
  documents are found by its **id** — in the file's path or body — and, when a ticket branch
  exists, by what that branch touched. Measured on this repo, `git grep -i RIC-505 -- '*.md'`
  answers exactly that ticket's spec and plan, plus `CLAUDE.md`.
- **Every markdown** git knows in the checkout, not only `docs/superpowers/{specs,plans}`:
  `git ls-files` replaces v1's directory walk and its skip rules (`.gitignore` keeps
  `node_modules` out; nested worktrees are never descended into).
- **No overlay**: a normal page, as the git graph. Back to the terminal reattaches the pty
  with its scrollback replayed.
- **`.md` paths in the terminal are links** to the viewer.
- **Relative `.md` links inside a document open in the viewer** — v1 left them inert only
  because leaving its SPA tore down the terminal socket.

## 1. Routes and entry points

One lazy page, `/docs/:project`, with its state in the url:

```
/docs/Mojito%20v2?ticket=RIC-506&path=docs/superpowers/specs/2026-10-30-docs-viewer-design.md
```

- `ticket` — group that ticket's documents on top of the list; with a ticket worktree (§2.2)
  it also picks the root.
- `path` — the document open; relative to the root, or absolute (§2.4).

Opening a document **pushes** an entry: Back steps document → list → wherever the page was
opened from. A document is linkable. `lib/docs/url.ts` is the codec (`parseDocsSearch`,
`docsHref(project, { ticket, path })`), shared by the page and the entry points.

Entry points:

- **Project header**: a lucide `FileText` icon beside `GitGraph` → `/docs/<project>`.
- **Ticket sheet**: a "Docs" button beside "Git" → `/docs/<project>?ticket=<id>`, with or
  without a live session.
- **Terminal header**: a `FileText` icon beside `GitGraph` → `?ticket=<id>` for a ticket
  session, none for a free session in a project; hidden for General sessions (no project).
- **Terminal output**: a `.md` path claude printed (§3.4) →
  `/docs/<project>?ticket=<id>&path=<as printed>`, pushed.

## 2. Server

### 2.1 Endpoints

Both behind `x-mojito-token`, both read-only, both under the project:

| Route | Answer |
|---|---|
| `GET /api/projects/:name/docs?ticket=ID` | `DocList` |
| `GET /api/projects/:name/docs/file?path=P&ticket=ID` | `DocFile` |

Status codes (bodies always `{ error }`):

- unknown project → 404; project path missing on disk → 400 (as the git routes);
- `ticket` not `isValidTicket` → 400, git never called;
- `path` missing, empty, holding a NUL or `..`, not ending in `.md` (any case), or outside
  every allowed root (§2.4) → 400 — never 404, which would say whether the file exists;
- a valid path with no file behind it → 404; over 512 KB → 413;
- the listing's `git ls-files` failing (not a repo, a timeout) → 409 with git's own words
  (first 500 chars), as the git routes.

Every git call goes through `readGit` (10 s).

### 2.2 Root — `src/docs/root.ts`

The directory the list is read from and relative paths resolve against:

- the project checkout, `expandHome(project.path)`;
- **except** with `ticket` when the ticket's branch is checked out in **another worktree**:
  then that worktree, plus the checkout's `git rev-parse --show-prefix` (so a project that is
  a subdirectory of its repo lines up in the worktree too). The list and the documents are
  that worktree's view of the project — where the ticket's session writes.

The branch is `findTicketBranch` over the refs and worktree list `graph.ts` already reads
(`for-each-ref` with `REF_FORMAT`, `parseRefs`, `worktree list --porcelain`,
`parseWorktrees`); the worktree path comes from `parseWorktrees`' entry for that branch
(non-prunable). Any failure while looking for the ticket worktree falls back to the checkout.

### 2.3 List — `src/docs/list.ts`

1. **All documents**: `git ls-files -z --cached --others --exclude-standard -- ':(icase)*.md'`
   in the root. Tracked and uncommitted files, `.gitignore` respected, paths relative to the
   root (only its subtree), nested repositories and worktrees not descended into (verified:
   a worktree under `.wt/` is not listed). Each path is `stat`ed: a tracked file deleted in
   the working tree, or anything not a regular file, is dropped. Sorted by mtime, newest
   first, then path.
2. **Ticket documents** (with `ticket`), the union of:
   - paths holding the id as a whole token — the same rule as `findTicketBranch` (bounded by
     the start/end or one of `/ _ - .`, case-insensitive); the regex moves to a shared
     `ticketToken(ticket)` in `ticketBranch.ts` so both use one;
   - `git grep -l -z -i -w --untracked -e <id> -- ':(icase)*.md'` in the root — bodies that
     mention it (`-w`: `RIC-5050` does not match `RIC-505`); exit 1 means none;
   - with a ticket branch and a default base (`defaultBase`):
     `git diff --name-only -z --relative <baseTip>...<branchTip> -- ':(icase)*.md'` — what the
     branch touched, even without the id in it.

   Kept only when present in (1). Best-effort: a failure of grep or diff only loses that
   source. `CLAUDE.md` lands in every ticket's group (it cites them all); accepted.

### 2.4 File — `src/docs/file.ts`

`resolveDocPath(path, roots)`, the security boundary, then `readDoc`:

- reject an empty path, a NUL, any `..` segment, anything not ending in `.md` (any case);
- `~/…` expands to HOME, then counts as absolute;
- **relative** → `resolve(root, path)` must stay inside the root;
- **absolute** → must lie inside one of the **allowed roots**: the root, plus every
  non-prunable worktree of the repo with the project prefix appended (the checkout included);
  the worktree list is read only for an absolute path;
- containment compares with the separator appended (a sibling `…/repo-old` is not inside
  `…/repo`), and is checked again after `realpath` (a symlink pointing out is rejected); a
  missing file skips the `realpath` step and answers 404 at the read;
- `readDoc`: `stat` — not a regular file → 404, over 512 KB → 413 — then read as UTF-8.

Answer: `{ path, content }`, `path` echoed as asked.

### 2.5 Shared types — `packages/shared/src/docs.ts`

```ts
interface DocEntry { path: string; mtime: string; size: number }   // path relative to the root, "/"
interface DocList { docs: DocEntry[]; ticketDocs: string[] }       // ticketDocs: paths in docs
interface DocFile { path: string; content: string }
const DOC_MAX_BYTES = 512 * 1024;
```

`isDocPath(p)` (non-empty, no NUL, no `..` segment, ends in `.md`) lives here too: the server
checks it first and the client uses it to classify links.

### 2.6 Wiring

`http/routes/docs.ts`, mounted like `gitGraph.ts`, with an injectable `DocsReader`
(`list(cwd, ticket)`, `file(cwd, path, ticket)`) on `AppDeps` (`docsRead`) so the routes are
tested without git.

## 3. Web

### 3.1 Pure logic — `src/lib/docs/`

- `url.ts` — `parseDocsSearch`/`docsHref`; drops a `path` that is not `isDocPath`.
- `list.ts` — `docGroups(list, ticket)` → `{ ticket: DocEntry[] | null, all: DocEntry[] }`;
  `docLabel(path)` → `{ name, dir }`.
- `links.ts` — `classifyHref(href, docPath)` → `{ kind: "external", href }` (http, https),
  `{ kind: "mail", href }`, `{ kind: "doc", path }` (a relative `.md` link, an optional
  `#…` dropped, resolved against the document's directory with `.`/`..` collapsed; a
  relative link from an absolute document stays absolute), or `{ kind: "inert" }` (anything
  else: a bare `#anchor`, another scheme, no href, a link climbing above a relative root).

### 3.2 Data — `src/hooks/useDocs.ts`

- `useDocList(project, ticket)` and `useDocFile(project, ticket, path)`, keys in **`docKeys`,
  apart from `qk`**: `useEvents` invalidates every `qk` value on each reconnect, and a
  document re-read under the reader is worse than one Reload away.
- `gcTime: 0`, `staleTime: Infinity`, `refetchOnWindowFocus: false`: each entry to the page
  is a fresh read; Reload invalidates `docKeys.project(project)`.

### 3.3 Components — `src/components/docs/`

- `DocsPage` (lazy route): pays its own safe-area insets (added to `test/safeArea.test.ts`).
  - **List** (no `path`): header with Back (`useBackOr`, else the board), `<project> · docs`,
    Reload. With a ticket, a `RIC-506` group, then "All documents" (a ticket's documents are
    in both); an empty group says "No documents for RIC-506". Rows are `<Link>`s that push
    `path`, ≥ 44px, two lines: the file name, then the directory (muted, truncated from the
    left) · relative time.
  - **Document** (`path`): header with Back, the file name, Reload; the directory under it,
    muted. Body `MarkdownView`.
- `MarkdownView`: `react-markdown` + `remark-gfm`, styled with `@tailwindcss/typography`
  (`prose dark:prose-invert max-w-none`, the plugin added to `index.css`). Raw HTML is not
  rendered (react-markdown's default). `a` goes through `classifyHref`: external → new tab
  (`noopener noreferrer`), mail → plain link, doc → a router `<Link>` that pushes, inert →
  text. `img` renders its alt text only — no fetch. `pre` and `table` scroll inside their own
  box; the page never pans.

New dependencies (web): `react-markdown`, `remark-gfm`, `@tailwindcss/typography` — all in
the lazy chunk except the CSS plugin.

### 3.4 Terminal `.md` links — `lib/terminal/links.ts`

`findLinks` learns a second matcher over the same joined logical line, so a path claude
wrapped is one link. Each found link carries `kind: "url" | "doc"`.

- **Path matcher**: an optional `~/`, `/` or `./`, then `segment/…/name.md`
  (segments of `[\w.@+-]`, case-insensitive `.md`); not preceded by a path character
  (`[\w./~@+-]`) and not followed by `[\w/]` — so `README.md.` and `` `x.md` `` match and a
  `:12` suffix stays out. A leading `./` is dropped (`docsHref` normalizes it); a path with a
  `..` segment is not a link (the server would refuse it, §2.4). Paths with spaces are a
  known limit.
- A doc match overlapping a URL match is dropped: `https://…/README.md` stays a URL.
- `urlLinkProvider` becomes `terminalLinkProvider(term, { openUrl, openDoc? })`; without
  `openDoc` doc matches are not offered. `TerminalView` takes an optional `openDoc(path)`;
  `TerminalPage` passes `navigate(docsHref(project, { ticket, path }))` for a session with a
  project, nothing for General.

The server decides what the path means (§2.4): a path printed relative to some other cwd can
answer "Document not found" — the honest answer.

### 3.5 Errors

| Case | Shows |
|---|---|
| 404 on the list | "Unknown project", Back |
| 409 on the list | git's message, Reload |
| `docs: []` | "No markdown documents." |
| 404 on a document | "Document not found" and the path |
| 413 on a document | "Too large to display (over 512 KB)." |
| 400 on a document | "Not a markdown file in this project." |
| other failure | the error, Reload |

## 4. Testing

Server (`apps/server/test/docs/`, `test/http/`):

- `file.test.ts` — `resolveDocPath`: `..`, NUL, non-`.md`, empty, a symlink out, an absolute
  path outside every root, a sibling-prefix directory, `~/`, a missing file (resolves, then
  404 at the read), a file over the cap (413).
- `list.integration.test.ts` — a real temp repo (global config off, as `sync.test.ts`):
  tracked, untracked and ignored markdown, a deleted tracked file, a nested worktree not
  listed, mtime order; ticket documents by path token, by body (`RIC-5050` not matching) and
  by branch diff; the ticket-worktree root; a project in a subdirectory of its repo.
- `ticketBranch.test.ts` — still green with the shared `ticketToken`.
- `test/http/docs.test.ts` — status codes and validation with an injected reader.

Web (`apps/web/test/lib/`):

- `docs/url.test.ts` — round trip, a bad `path` dropped.
- `docs/list.test.ts` — groups, labels.
- `docs/links.test.ts` — every `classifyHref` kind; `../plans/x.md#a`, `./x.md`, an absolute
  document, climbing above the root.
- `terminal/links.test.ts` — doc matches (bare, `./`, `~/`, absolute, wrapped over rows,
  `:12`, trailing `.`, backticks), no match with a `..` segment, URL precedence, no doc links
  without `openDoc`.
- `safeArea.test.ts` — the new page.
