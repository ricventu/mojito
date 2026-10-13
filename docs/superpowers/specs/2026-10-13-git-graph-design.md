# Git graph view — design

## Goal

A read-only view of a repo's branch and commit graph, serving two needs at once:

- **a general repo log** — browse recent history, branches and tags from any device,
  phone included;
- **ticket-branch state** — see where a ticket's branch sits against the default branch
  (ahead, behind, already merged), which is the question the review gate and cleanup ask.

Success: from a project divider, a terminal or a ticket's launch sheet, one tap shows the
graph with the relevant branch highlighted and its ahead/behind count, readable at 320px.

## Scope

In: graph of local branches, `origin/*` branches and tags; the 200 most recent commits in
topo order with "Load more"; tap a commit for its full message, author, date and changed
files (name + status).

Out: diffs, any git action (checkout, delete, fetch), fetch on open, live updates, remotes
other than `origin`. The graph shows whatever the last fetch left; the project toolbar's
existing Pull and the launch sheet's Fetch are how refs are refreshed.

## Server

### Target resolution — `src/server/gitTarget.ts`

Same shape as `resolveDocsTarget` (`docTarget.ts`), with injected deps so tests need no
registry or real state dir. Answers `{ ok: true, repo, cwd, label, highlight: string | null }`
or `{ ok: false, error, code: 400 | 404 | 409 }`.

| Query | cwd | highlight |
|---|---|---|
| `project=<name>` | repo path from `projects.json` (404 if unmapped) | none |
| `session=<id>` | ticket worktree via `resolveTicketWorktree`, else `meta.cwd` (as docs does; 404 unknown session, 400 no cwd) | current branch of that cwd |
| `ticket=<id>[&project=]` | `resolveTicketWorktree`, else the repo root from `repoForTicket` (404 if neither) | the worktree's branch, or none |

"Current branch" is `git rev-parse --abbrev-ref HEAD`; a detached HEAD (`HEAD`) yields no
highlight.

### Graph read — `src/server/gitGraph.ts`

Pure parsers plus an injected `GitRun`, the split `worktree.ts` already uses. Git calls
run with a 10s timeout.

1. **Commits**:
   `git log --topo-order --branches --remotes=origin --tags HEAD --skip=<N> -n 201
   --format=%H%x00%P%x00%an%x00%aI%x00%s%x1e`. Records split on `\x1e`, fields on `\x00`,
   so no subject character can break the parse. The 201st record only sets `hasMore` and
   is dropped.
2. **Refs**: `git for-each-ref --format=%(objectname)%00%(*objectname)%00%(refname)
   refs/heads refs/remotes/origin refs/tags`. Annotated tags map to their peeled
   `%(*objectname)`; `refs/remotes/origin/HEAD` is dropped as a duplicate. Refs are not
   parsed out of `%D`, which is ambiguous for branch names containing `,` or `->`.
3. **Worktrees**: `git worktree list --porcelain` through the existing `parseWorktrees`. A
   local branch checked out in a worktree gets `worktree: true`; one whose path is under
   `<repo>/.claude/worktrees/` also gets `mojito: true`.
4. **Highlight stats**, only when there is a highlight: the default branch as
   `origin/<detectDefaultBranch>` (`merge.ts`) (falling back to the local default), then
   `git rev-list --left-right --count <default>...<branch>` → `{ branch, tip, base,
   baseTip, ahead, behind, merged: ahead === 0 }`. No resolvable default branch → the
   highlight still names the branch, with `base` empty and the strip showing the branch
   alone. Exact regardless of the loaded window. Computed on the
   first page only (`skip=0`).

Response:

```ts
interface GitGraphResponse {
  label: string;
  head: string | null;                 // HEAD hash of the target cwd
  highlight: {
    branch: string; tip: string;       // name + hash
    base: string; baseTip: string;     // e.g. origin/main + hash
    ahead: number; behind: number; merged: boolean;
  } | null;
  commits: {
    hash: string; parents: string[]; author: string; date: string; subject: string;
    refs: { name: string; kind: "local" | "remote" | "tag"; worktree?: true; mojito?: true }[];
  }[];
  hasMore: boolean;
}
```

### Commit details

`git show --no-patch --format=%H%x00%an%x00%ae%x00%aI%x00%B <hash>` and
`git show --format= --name-status -M <hash>`. The hash must match `^[0-9a-f]{7,40}$`
(400 otherwise, git never called) and goes after `--end-of-options`. File lists beyond 300
entries are truncated with a `more: <n>` count. Merge commits list their files against the
first parent (`-m --first-parent`).

### Routes

- `GET /api/git/graph?<target>&skip=<N>` — `skip` defaults to 0, must be a non-negative
  integer (400 otherwise).
- `GET /api/git/commit?<target>&hash=<hash>`.

Both authenticated like every other `/api` route. Not a repo / a failing git call / a
timeout → 409 with `gitFailureDetail`. An empty repo (no commits) is a 200 with
`commits: []`, not an error.

## Client

### Lane layout — `src/lib/gitGraph.ts`

Pure, node-testable. `layoutGraph(commits, { maxLanes }) → { rows, laneCount, hiddenLanes }`.

Single pass over commits in topo order, keeping `lanes: (hash | null)[]` — the commit
each lane is waiting for:

1. The commit's lane is the first one waiting for its hash; if none, it is a new tip and
   takes the first free slot (or appends).
2. Any other lane waiting for the same hash converges into it and is freed.
3. The lane now waits for the first parent; a root frees it.
4. Each further parent reuses a lane already waiting for it, or opens a free slot.

Each row: `{ lane, color, top: Segment[], bottom: Segment[] }` with `Segment = { from,
to, color }` in lane indices — `top` enters the row from above, `bottom` leaves it — so a
row renders as an independent fixed-height SVG strip. A parent outside the loaded window
leaves its lane open at the bottom. "Load more" recomputes the layout over the
concatenated list (O(commits × lanes)).

**Colours**: an index is assigned when a lane opens and inherited along first parents, so
a branch keeps one colour for its run. Palette is `--graph-0…--graph-7` in `globals.css`,
with dark-mode values.

**Cap**: lanes ≥ `maxLanes` render in the last column; `hiddenLanes` reports how many were
folded so the header can show `+N`. `maxLanes` is 5 below 480px, 12 otherwise.

**Highlight**: `highlightChain(commits, highlight.tip, highlight.baseTip)` → the set of hashes on the
first-parent chain from the highlighted tip down to (excluding) the first commit also on
the base's first-parent chain. Those rows render in the accent colour; others are dimmed.

### Routes — `src/lib/appLocation.ts`

- `/git/project/<name>` — standalone view.
- `/git/ticket/<id>?docProject=<project>` — standalone view; reuses `docProject`.
- `/session/<id>/git` — overlay inside TerminalView, like `/session/<id>/docs`, so the
  pty's `tmux attach` stays alive underneath.
- `?commit=<hash>` on any of them opens the details sheet; Back closes it before leaving the
  view, and a single commit is linkable.

`AppView` gains `{ kind: "git"; target: GitTarget; commit: string | null }` and the session
view's overlay field generalises to `docs | git`.

### Component — `src/components/GitGraphView.tsx`

Loaded with `next/dynamic` so the board chunk does not carry it.

- **Header** (`.docs-head` shape): Back, label (`Mojito · git`, `RIC-123 · git`), `+N
  lanes` when capped, Reload.
- **Highlight strip** under the header when there is a highlight:
  `<branch> · 3 ahead · 12 behind origin/main`, or `<branch> · merged into origin/main`.
  For a ticket with no worktree: "No branch for this ticket yet".
- **Rows**, 28px fixed: SVG lanes (`aria-hidden`), ref chips (local / `origin/` / tag, plus
  a worktree badge), subject truncated to one line, short hash + `relativeTime` date. Below
  480px hash and date drop to a smaller second line. Each row is a `button` labelled by its
  subject.
- On first load, scroll the highlighted tip into view if it is not among the first rows.
- **Load more** at the end while `hasMore`.
- **Details** in a bottom `.sheet`: full hash, author, date, full message, file list with
  A/M/D/R status.
- Pays `--sat`/`--sab` like `.docs-root`.
- No polling, no websocket: a snapshot with Reload, like docs.

### Entry points

- **Project toolbar**: lucide `GitGraph` icon beside Logs on every mapped project
  (`projectActions` in `src/lib/projectToolbar.ts`).
- **Terminal header**: `GitGraph` icon beside Documents; hidden for General sessions (no
  project, home directory is not a repo).
- **Launch sheet**: ghost "Git" button beside "Docs" on every ticket.

### Errors

- 404 → "This session no longer exists" / "Unknown project", with Back.
- 409 → the git error verbatim, with Reload.
- `commits: []` → "No commits yet".
- Failed Load more → rows kept, button becomes Retry.
- Failed commit details → error inside the sheet, sheet stays open.

## Tests

Server (`tests/server/`):

- `gitGraph.test.ts`: log parser (subjects with `|`, `,`, `->`; root commits; 201 vs 200
  records → `hasMore`); ref mapping (peeled annotated tags, `origin/HEAD` dropped,
  worktree and mojito badges); highlight stats including `merged`; hash validation never
  reaches git.
- `gitTarget.test.ts`: all three target shapes and their status codes.
- `gitGraph.integration.test.ts`: a real temp repo (skipped without git) with two
  branches, a merge and an annotated tag, asserting the parser against git's actual
  output rather than a fake.
- Route tests for `skip` and `hash` validation.

Client (`tests/lib/`, `tests/client/`):

- `gitGraph.test.ts` layout: linear history, fork + merge, octopus merge, parallel tips,
  parent outside the window, lane reuse after a merge, colour stability along first
  parents, the lane cap, `highlightChain` for an unmerged and an already-merged branch.
- `appLocation` round trip for the three new routes and `commit`.
- `safeArea.test.ts`: the new surface.
- `projectToolbar` test: the new action is offered on every mapped project.
