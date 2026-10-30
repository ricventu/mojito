# Git graph (v2) — design

Ticket: RIC-505. Sub-project 4 of the v2 roadmap
(`2026-10-28-mojito-rewrite-core-design.md`, "Roadmap dei sotto-progetti successivi").
v1 reference: `git show main:docs/superpowers/specs/2026-10-13-git-graph-design.md`.

## Goal

A read-only view of a project's commits, branches and tags, usable on a phone, answering two
questions:

- **what happened in this repo lately** — a general log with branches and tags;
- **where a ticket's branch stands** — ahead of, behind, or merged into `origin/<default>`.

Success: from a project header, a ticket sheet or a terminal, one tap shows the graph with
the relevant branch highlighted and its ahead/behind count; a tap on a commit shows its
details, a tap on a file its diff; readable at 320px.

Out of scope: any git action (checkout, delete, fetch, …), fetching on open, live updates,
remotes other than `origin`, side-by-side diffs, syntax highlighting. The graph is whatever
the last fetch left — the project header's Pull is how refs are refreshed.

### What changes from v1

- **One page per project** instead of three targets. A ticket is a highlight on its
  project's graph, not a target of its own.
- **A ticket's branch is found by its id in the branch name**, wherever the worktree is:
  v2 never creates worktrees at launch, and a session's `cwd` is the project path, so v1's
  "the branch checked out in the session's cwd" no longer finds it. The lookup is shared
  with the merge gate (roadmap item 2), which needs the same thing.
- **No terminal overlay**: from a terminal the graph is a normal navigation. Leaving and
  coming back reattaches the pty with its scrollback replayed.
- **Diffs**, per file, inside the commit sheet.
- **Pages load on scroll** (a sentinel), and TanStack's infinite query replaces v1's
  hand-rolled generation counter for late "load more" answers.
- The "Mojito worktree" ref badge is gone (v2 makes no worktrees); the plain worktree badge
  stays.

## 1. Routes and entry points

One lazy page, `/git/:project`, with its state in the url:

```
/git/mojito?ticket=RIC-505&commit=0244916…&file=apps/web/src/routes.tsx&from=…
```

- `ticket` — highlight that ticket's branch (§2.3) instead of the checkout's branch.
- `commit` — the details sheet is open on that commit.
- `file` (+ `from` for a rename/copy) — the sheet shows that file's diff.

Opening a commit **pushes** an entry, opening a file's diff pushes another: Back steps
diff → details → graph → wherever the graph was opened from. A single commit or diff is
linkable. `lib/git/url.ts` is the codec (parse + build), shared by the page and the entry
points.

Entry points:

- **Project header**: a lucide `GitGraph` icon beside Pull/Push → `/git/<project>`.
- **Ticket sheet**: a "Git" button → `/git/<project>?ticket=<id>`, shown with or without a
  live session.
- **Terminal header**: a `GitGraph` icon → `/git/<project>?ticket=<id>` for a ticket
  session, `/git/<project>` for a free session in a project; hidden for General sessions
  (no project).

Page header: Back (history back when the previous entry is ours, else the board), the label
`<project> · git`, `+N lanes` when lanes are folded, Reload.

**Highlight strip** under the header:

- with `ticket`: that ticket's branch — `ric-505-git-graph · 3 ahead · 12 behind
  origin/main`, `… · merged into origin/main`, `… · even with origin/main`; no matching
  branch → `No branch for RIC-505 yet`;
- without `ticket`: the branch checked out in the project's checkout, measured the same way
  (on `main`: `main · 2 ahead · 0 behind origin/main` — what Pull/Push are about to do);
  detached HEAD → no strip;
- no default branch found → the branch name alone.

"Even with" is when the tip *is* the base's tip; "merged" is when nothing is ahead
otherwise. The server's `merged` (ahead = 0) cannot tell a fresh branch from a merged one,
hence the tip comparison (a v1 lesson).

A successful Pull or Push invalidates that project's graph.

## 2. Server

### 2.1 Endpoints

All behind `x-mojito-token`, all read-only, all under the project:

| Route | Answer |
|---|---|
| `GET /api/projects/:name/git/graph?skip=N[&ticket=ID]` | `GitGraphPage` |
| `GET /api/projects/:name/git/commits/:hash` | `CommitDetails` |
| `GET /api/projects/:name/git/commits/:hash/diff?path=P[&from=F]` | `CommitDiff` |

Status codes (bodies always `{ error }`):

- unknown project → 404; project path missing on disk → 400 (as Pull/Push);
- `skip` not a non-negative integer, `hash` not `^[0-9a-f]{7,40}$`, `path` missing or empty,
  `ticket` not `^[A-Za-z][A-Za-z0-9]*-\d+$` → 400, git never called;
- a valid hash that does not resolve to a commit → 404;
- not a repo, a failing git call, a timeout → 409 with git's own message (first 500 chars);
- an empty repo (no commits) → 200 with `commits: []`.

### 2.2 Graph read — `src/git/graph.ts`

Pure parsers on top, the git calls below over the injected `GitRun` (the split `sync.ts`
uses). Every read runs with a 10 s timeout: `runGit` gains an optional `timeout`, Pull/Push
keep their 120 s.

1. **Refs**: `for-each-ref --format=%(objectname)%00%(*objectname)%00%(refname)%00%(committerdate:unix)
   refs/heads refs/remotes/origin refs/tags`. Annotated tags map to their peeled commit
   (the tag object's own hash is in no history); `refs/remotes/origin/HEAD` is dropped.
   Refs are never parsed out of `%D`, which is ambiguous for names with `,` or `->`. This
   is the call that fails outside a repo → 409.
2. **HEAD**: `rev-parse --verify -q HEAD` (null on an empty repo) and
   `symbolic-ref --quiet --short HEAD` (null when detached).
3. **Worktrees**: `worktree list --porcelain`; a local branch checked out in a live
   (non-prunable) worktree gets `worktree: true`. A failure here only loses the badges.
4. **Commits**: `log --topo-order --format=%H%x00%P%x00%an%x00%aI%x00%s%x1e --skip=N -n 201
   --branches --remotes=origin --tags [HEAD] --`. Records split on RS, fields on NUL, so no
   subject can break the parse. The 201st record only sets `hasMore`. No refs and no HEAD →
   empty repo, no `log` call.
5. **Highlight**, only on `skip=0`: the branch is `findTicketBranch` with `ticket`, else the
   checked-out branch; the base is `defaultBranch`; then
   `rev-list --left-right --count <baseTip>...<tip>` → `{ branch, tip, base, baseTip, ahead,
   behind, merged: ahead === 0 }` — exact regardless of the loaded window. The default
   branch measured against itself (`main` vs `origin/main` is fine; `origin/main` vs itself
   is not) skips to the next candidate base.

### 2.3 Ticket branch — `src/git/ticketBranch.ts`

`findTicketBranch(refs, ticket)`, pure, over the refs read in 2.2 (no extra git call):

- **match**: case-insensitive, the id as a whole token of the branch name — bounded by the
  start/end or one of `/ _ - .`, and not followed by a digit. `ricventu/ric-505-git-graph`,
  `RIC-505`, `fix/ric-505` match; `ric-5050`, `xric-505` do not;
- **pick**: a local branch over an `origin/` one (an `origin/x` whose local `x` also matched
  is the same branch); then one checked out in a worktree; then the most recent committer
  date; then the name, for a stable answer.

Answers `{ name, kind, hash } | null`. The merge gate will import it as is.

### 2.4 Default branch — `src/git/defaultBranch.ts`

Over the same refs plus one call: `symbolic-ref --quiet refs/remotes/origin/HEAD`
(→ `origin/main`); else `origin/main`, else `origin/master` if listed; else local `main`,
else `master`; else null (the strip names the branch alone).

### 2.5 Commit details and diff — `src/git/commit.ts`

- The hash is validated (2.1), then resolved: `rev-parse --verify -q --end-of-options
  <hash>^{commit}` → the full hash, or 404. Only the full hash reaches the next calls.
- **Details**: `show -s --format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B <full>` and
  `show --format= --name-status -z -M --diff-merges=first-parent <full>` (`-z`: no
  C-quoting of odd paths). Files capped at 300, `moreFiles` counts the rest. A merge lists
  what it brought in against its first parent, not the combined diff (which lists only
  conflicts).
- **Diff**: `show --format= --patch -M --no-color --no-ext-diff --diff-merges=first-parent
  <full> -- :(literal)<path> [:(literal)<from>]`. Literal pathspecs: no glob magic from a
  query value. Passing `from` too keeps a rename a rename. Output starts at the first `@@`
  (the `diff --git`/`index`/`---`/`+++` header is dropped); `Binary files … differ` →
  `binary: true`, no patch; over 256 KB → cut at the last full line, `truncated: true`.

### 2.6 Shared types — `packages/shared/src/git.ts`

```ts
interface GraphRef { name: string; kind: "local" | "remote" | "tag"; worktree?: true }
interface GraphCommit { hash: string; parents: string[]; author: string; date: string; subject: string; refs: GraphRef[] }
interface GraphHighlight { branch: string; tip: string; base: string; baseTip: string; ahead: number; behind: number; merged: boolean }
interface GitGraphPage { head: string | null; highlight: GraphHighlight | null; commits: GraphCommit[]; hasMore: boolean }
interface CommitFile { status: string; path: string; from?: string }
interface CommitDetails { hash: string; parents: string[]; author: string; email: string; date: string; message: string; files: CommitFile[]; moreFiles: number }
interface CommitDiff { patch: string; binary: boolean; truncated: boolean }
```

`highlight` is null on pages after the first; the client keeps the first page's. On the
first page with `ticket` and no matching branch it is null too — the strip then says "No
branch for … yet".

## 3. Web

### 3.1 Pure logic — `src/lib/git/`

- `layout.ts` — `layoutGraph(commits, { maxLanes }) → { rows, laneCount, hiddenLanes }`.
  One pass in topo order over `lanes: ({hash, color} | null)[]`, each lane waiting for one
  commit:
  1. the commit takes the first lane waiting for it, else (a new tip) the first free slot;
  2. every other lane waiting for it converges into it and is freed;
  3. the lane then waits for the first parent (a root frees it), keeping its colour;
  4. each further parent reuses a lane already waiting for it, or opens a free slot with a
     new colour. Lanes opened in this row are **recorded as they open**, not inferred from
     the row above — inferring drew a stray straight segment when a merge parent reopened a
     slot freed in the same row (v1).

  A row is `{ lane, color, top: Segment[], bottom: Segment[] }`, `Segment = { from, to,
  color }` in lane indices — `top` enters from above and ends at the commit, `bottom` leaves
  it — so each row draws on its own. Colours cycle through 8. Lanes ≥ `maxLanes` fold into
  the last column (duplicate segments dropped); `hiddenLanes` says how many.
- `highlight.ts` — `highlightChain(commits, tip, baseTip)`: the first-parent run from the
  tip down to (excluding) the first commit on the base's first-parent run, within the loaded
  window; `highlightSummary(highlight, ticket)` → the strip text (§1) or null.
- `diff.ts` — `diffLines(patch)` → `{ kind: "add" | "del" | "hunk" | "ctx" | "note", text }[]`
  (`note` for `\ No newline at end of file`).
- `url.ts` — `parseGitSearch`/`gitHref(project, { ticket, commit, file, from })`.

### 3.2 Data — `src/hooks/useGitGraph.ts`

- Graph: `useInfiniteQuery`, key `gitKeys.graph(project, ticket)`, `getNextPageParam` →
  the commits loaded so far while `hasMore`. A reload or a retarget is a new query, so a
  page answer for the old one cannot land in the new one.
- `useCommit(project, hash)`, `useDiff(project, hash, file, from)`: plain queries,
  `staleTime: Infinity` — a commit never changes.
- The graph is a snapshot: `staleTime: Infinity`, `refetchOnWindowFocus: false`, and it is
  not among the queries `useEvents` invalidates on (re)connect — rows jumping while you read
  is worse than being one fetch behind. **`gitKeys` lives apart from `qk`**: `useEvents`
  invalidates every `Object.values(qk)` on connect. Reload invalidates `gitKeys.project(p)`;
  so does a successful Pull/Push in `GitButtons`.

### 3.3 Components — `src/components/git/`

- `GitGraphPage` (lazy route): header, highlight strip, rows, sentinel. The page pays its
  own safe-area insets (added to `test/safeArea.test.ts`).
  - **Row**: a `<Link>` that pushes `?commit=`. Below 480px two lines, ≥ 44px: ref chips +
    subject, then short hash · relative date; above, one line. Ref chips: local (with a
    worktree icon when checked out), `origin/…`, tag; they shrink before the subject does.
    The highlighted branch's chip and chain use the primary colour; with a highlight, other
    rows are dimmed.
  - Lane cap 5 below 480px, 12 above (`useMediaQuery`).
  - On first load, the highlighted tip is scrolled into view when it is not among the
    first rows.
  - An `IntersectionObserver` sentinel loads the next page; a failed page keeps the rows
    and turns the sentinel into a Retry button.
- `GraphLanes`: one `aria-hidden` SVG per row; straight segments for `from === to`, a
  cubic curve otherwise; colours `--graph-0…7`, defined for light and dark in `index.css`.
- `CommitSheet`: shadcn bottom `Sheet` (~90dvh), its own ✕ paying the insets
  (`showCloseButton={false}`, as the other overlay sheets). Short hash with a copy button,
  author · date, the refs on the commit, the full message, then the files (status letter +
  path, `from → path` for a rename) as links that push `&file=`.
- `DiffView`: replaces the details inside the sheet, with a back chevron (history back).
  A monospace `<pre>`, no wrap, horizontal scroll, lines tinted by kind; "Binary file" /
  "Diff truncated at 256 KB" notices.

Entry points as in §1: `ProjectSection` header, `TicketSheet`, `TerminalPage` header.

### 3.4 Errors

| Case | Shows |
|---|---|
| 404 on the graph | "Unknown project", Back |
| 409 on the graph | git's message, Reload |
| `commits: []` | "No commits yet." |
| failed next page | rows kept, Retry |
| 404 on details / diff | "Commit not found" inside the sheet |
| other details / diff failure | the error inside the sheet; the sheet stays open |

## 4. Testing

Server (`apps/server/test/git/`, `test/http/`):

- `graph.test.ts` — parsers against strings: log (subjects with `|`, `,`, `->`; roots;
  201 vs 200 records → `hasMore`), refs (peeled tags, `origin/HEAD` dropped,
  worktree badges), counts.
- `ticketBranch.test.ts` — matching (token boundaries, case, `ric-5050`), picking order.
- `defaultBranch.test.ts` — each fallback.
- `commit.test.ts` — name-status `-z` (renames, odd paths), diff header stripping, binary,
  truncation at a line boundary; an invalid hash never reaches the runner.
- `graph.integration.test.ts` — a real temp repo (global config off, as `sync.test.ts`):
  two branches, a merge, an annotated tag, a worktree, a ticket branch, a rename, a binary
  file; asserts the reads against git's actual output.
- `test/http/gitGraph.test.ts` — the routes' status codes and validation with an injected
  reader.

Web (`apps/web/test/lib/git/`):

- `layout.test.ts` — linear, fork + merge, octopus, parallel tips, parent outside the
  window, lane reuse after a merge (the stray-segment case), colour along first parents,
  the cap and `hiddenLanes`.
- `highlight.test.ts` — chain for unmerged / merged / fresh branches; every summary text.
- `diff.test.ts`, `url.test.ts` — line kinds; url round trip.
- `safeArea.test.ts` — the new page.
