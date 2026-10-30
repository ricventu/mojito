# Docs viewer (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only, phone-first viewer of a project's markdown at `/docs/:project`, with a ticket's documents grouped on top and `.md` paths in the terminal as links into it (RIC-506).

**Architecture:** Two read-only server routes under the project list markdown with `git ls-files` and read one file from disk behind a path guard; a ticket picks its documents by id (path token, `git grep`, branch diff) and, when its branch is checked out in another worktree, that worktree as root. The web page is a lazy route with url state (`ticket`, `path`), rendering with `react-markdown`; the terminal's link provider gains a second matcher for `.md` paths.

**Tech Stack:** Hono 4, node `fs`, git via `readGit`; React 19, react-router 8, TanStack Query 5, Tailwind 4 + `@tailwindcss/typography`, `react-markdown` + `remark-gfm`, `@xterm/xterm` 6; vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-docs-viewer-design.md`

## Global Constraints

- Work only in `apps/` and `packages/`; v1 (`src/`, `server.ts`, `tests/`) is untouched.
- Everything English: code, comments, copy, server messages.
- Server error bodies are always `{ error }`; every git call goes through `readGit` (10 s); never a git write or fetch.
- Doc cap `DOC_MAX_BYTES = 512 * 1024`; over it → 413.
- A rejected path is 400, never 404.
- Web: only Tailwind utilities + shadcn components; lucide icons with `size`; pure logic in `src/lib` tested in node (no jsdom).
- `docKeys` lives outside `qk`; doc queries `gcTime: 0`, `staleTime: Infinity`, `refetchOnWindowFocus: false`.
- Every edge surface pays its safe-area inset (`--sat/--sar/--sab/--sal`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verify with `pnpm v2:test && pnpm v2:typecheck` from the repo root.

## Review Focus

1. A project name with a space (`Mojito v2`) — every href and API path is `encodeURIComponent`'d; tested in Task 5 (`docsHref`) and Task 4 (route).
2. Non-ASCII and odd file names (`spec-perché.md`, a name with a space) — `-z` on every git listing, never C-quoted; tested in Task 3's integration test.
3. A ticket worktree that is prunable or whose directory is gone — the root falls back to the checkout; tested in Task 3.
4. Claude's tool output shapes around a path — `Write(docs/x.md)`, `` `docs/x.md` ``, `docs/x.md:12`, `docs/x.md.` — link exactly the path; tested in Task 7.
5. The ticket id is passed to `git grep` as a fixed string (`-F`) and after `-e`, never as a pattern or option; tested in Task 3 (`RIC-5050` not matching `RIC-505`, `ric-505` matching).

---

### Task 1: Shared doc types and `isDocPath`

**Files:**
- Create: `packages/shared/src/docs.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./docs";`)
- Test: `packages/shared/test/docs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface DocEntry { path: string; mtime: string; size: number }  // path relative to the root, "/" separated; mtime ISO
  interface DocList { docs: DocEntry[]; ticketDocs: string[] }      // ticketDocs ⊆ docs[].path, same order as docs
  interface DocFile { path: string; content: string }
  const DOC_MAX_BYTES: number; // 512 * 1024
  function isDocPath(p: string): boolean;
  ```

- [ ] **Step 1: Write the failing test** — `isDocPath`: true for `README.md`, `docs/a/B.MD`, `/abs/x.md`, `~/x.md`, `./x.md`; false for `""`, `x.txt`, `x.md.bak`, `a\0b.md`, `../x.md`, `docs/../x.md`, `a/..`, `.md` (no stem).
- [ ] **Step 2: Run** `pnpm --filter @mojito/shared test` → FAIL (module missing).
- [ ] **Step 3: Implement** `docs.ts` with a one-line header comment like `git.ts`'s. `isDocPath`: non-empty, no `\0`, no segment equal to `..` (split on `/`), basename longer than 3 and ending in `.md` case-insensitively.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(v2/shared): doc types and isDocPath (RIC-506)`.

---

### Task 2: Path guard and file read

**Files:**
- Modify: `apps/server/src/git/ticketBranch.ts` (extract `ticketToken`)
- Create: `apps/server/src/docs/file.ts`
- Test: `apps/server/test/docs/file.test.ts`; `apps/server/test/git/ticketBranch.test.ts` stays green

**Interfaces:**
- Consumes: `isDocPath`, `DOC_MAX_BYTES` (Task 1).
- Produces:
  ```ts
  // ticketBranch.ts
  function ticketToken(ticket: string): RegExp; // case-insensitive, not global; findTicketBranch uses it
  // docs/file.ts
  function resolveDocPath(path: string, root: string, allowed: string[], home: string): string | null;
  type ReadDocResult = { ok: true; content: string } | { ok: false; reason: "not-found" | "too-large" };
  function readDoc(abs: string, maxBytes?: number): ReadDocResult;
  ```
  `allowed` is the list absolute paths may fall in (it always contains `root`); a relative path resolves against `root` only. Null = 400.

- [ ] **Step 1: Write the failing tests** in a temp dir (`mkdtempSync`), real files and a symlink:
  - relative `docs/a.md` → `<root>/docs/a.md` (realpath'd);
  - absolute inside a second allowed root → that path; absolute outside every allowed root → null;
  - `~/x.md` with `home` = an allowed root → `<home>/x.md`; with `home` outside → null;
  - sibling prefix: root `/t/repo`, absolute `/t/repo-old/a.md` with `allowed=[root]` → null;
  - a symlink `root/out.md → <outside>/x.md` → null;
  - not `isDocPath` (`x.txt`, `../x.md`, `a\0.md`, `""`) → null;
  - a missing `root/gone.md` → its absolute path (not null);
  - `readDoc`: missing → `not-found`; a directory named `d.md` → `not-found`; `DOC_MAX_BYTES + 1` bytes → `too-large`; exactly the cap → ok with content.
- [ ] **Step 2: Run** `pnpm --filter @mojito/server test docs/file` → FAIL.
- [ ] **Step 3: Implement.** `ticketToken` returns the regex now inline in `findTicketBranch` (move it, same source, flag `i`). `resolveDocPath` follows spec §2.4 (port the shape of v1's `resolveDocPath`/`inside`, `git show main:src/server/docFiles.ts`): containment with the separator appended, re-checked against the `realpath` of each allowed root after `realpathSync` of the target; `ENOENT` skips the realpath step. `readDoc` uses `statSync`/`readFileSync(…, "utf8")`.
- [ ] **Step 4: Run** the docs and ticketBranch tests → PASS.
- [ ] **Step 5: Commit** `feat(v2/server): doc path guard and read (RIC-506)`.

---

### Task 3: Root, list and file readers

**Files:**
- Create: `apps/server/src/docs/root.ts`, `apps/server/src/docs/list.ts`
- Modify: `apps/server/src/docs/file.ts` (add `readDocFile`)
- Test: `apps/server/test/docs/docs.integration.test.ts`

**Interfaces:**
- Consumes: `GitRun`, `readGit` (`git/git.ts`); `REF_FORMAT`, `parseRefs`, `markWorktrees`, `parseWorktrees` (`git/graph.ts`); `findTicketBranch`, `ticketToken` (`git/ticketBranch.ts`); `defaultBase` (`git/defaultBranch.ts`); Task 2's `resolveDocPath`, `readDoc`.
- Produces:
  ```ts
  // root.ts
  interface DocRoot { root: string; branch: { name: string; hash: string } | null; base: { name: string; hash: string } | null }
  function docRoot(checkout: string, ticket: string | null, run: GitRun): Promise<DocRoot>;
  function allowedRoots(checkout: string, root: string, run: GitRun): Promise<string[]>;
  // list.ts
  function readDocList(checkout: string, ticket: string | null, run: GitRun): Promise<DocList>;
  // file.ts
  type DocFileResult = { ok: true; file: DocFile } | { ok: false; reason: "invalid" | "not-found" | "too-large" };
  function readDocFile(checkout: string, path: string, ticket: string | null, home: string, run: GitRun): Promise<DocFileResult>;
  ```

`docRoot`: without a ticket → `{ root: checkout, branch: null, base: null }` and no git call. With one: refs (`for-each-ref --format=REF_FORMAT refs/heads refs/remotes/origin`), worktrees, `findTicketBranch`, base via `symbolic-ref --quiet --short refs/remotes/origin/HEAD` + `defaultBase`; if the branch is local and checked out in a non-prunable worktree whose path is not the checkout's top level (`rev-parse --show-toplevel`) and exists on disk → `join(worktreePath, prefix)` with `prefix` from `rev-parse --show-prefix` in the checkout. Any failure → the checkout (branch/base null). `allowedRoots`: `root`, `checkout`, and every non-prunable worktree path + prefix; a failing worktree list → just the first two.

`readDocList` (spec §2.3): `ls-files -z --cached --others --exclude-standard -- ':(icase)*.md'` in the root — the only call allowed to throw (`GitError` → the route's 409); `stat` each, drop non-files, sort mtime desc then path. Ticket docs: path matches `ticketToken`; `git grep -l -z -I -i -w -F --untracked -e <ticket> -- ':(icase)*.md'` (exit 1 = none; any failure = none); with branch and base, `diff --name-only -z --relative <base.hash>...<branch.hash> -- ':(icase)*.md'` run in the root. Keep those present in `docs`, in `docs` order.

`readDocFile`: `isDocPath` false → `invalid` with no git call; else `docRoot`, `allowedRoots` only when the path is absolute or starts with `~/` (else `[root]`), `resolveDocPath` (null → `invalid`), `readDoc`; `path` in the answer is echoed as asked.

- [ ] **Step 1: Write the failing integration test** on a real temp repo (copy the `GIT_CONFIG_GLOBAL=/dev/null` / `GIT_CONFIG_NOSYSTEM=1` setup and `git`/`configure`/`commit` helpers from `test/git/graph.integration.test.ts`), using `readGit`:
  - list: tracked `README.md`, `docs/superpowers/specs/s.md`, untracked `notes/u.md`, ignored `build/i.md` (in `.gitignore`), `spec-perché.md`, `with space.md`, a committed `old.md` deleted from disk, a `.txt`; a worktree under `.wt/x` (in `.gitignore` *and* once not ignored) → paths are exactly the tracked + untracked non-ignored `.md` minus `old.md`; non-ASCII and space names verbatim; order follows mtimes set with `utimesSync`;
  - ticket docs: `docs/ric-7-plan.md` (path token), `docs/a.md` containing `Ticket: RIC-7`, `docs/b.md` containing `ric-7` lower-case, `docs/c.md` containing `RIC-70` only → `ticketDocs` has the first three, not `c.md`;
  - branch diff: branch `ricventu/ric-8-x` adds `docs/plain.md` (no id in it), `main` as base. Not checked out anywhere → the root is the checkout and `docs/plain.md` is in neither list (it is not on disk there). Checked out in a worktree `../wt8` → the root is that worktree and `docs/plain.md` is in `docs` and `ticketDocs`;
  - subdirectory project: checkout `repo/web`, the ticket worktree root is `<wt>/web`, and listed paths are relative to it;
  - prunable worktree: a ticket worktree whose directory was `rm -rf`'d → root falls back to the checkout;
  - `readDocFile`: relative OK; absolute inside the ticket worktree OK from the checkout; absolute in an unrelated temp dir → `invalid`; `../x.md` → `invalid`; missing → `not-found`;
  - not a repo: `readDocList` on a plain temp dir rejects with `GitError`.
- [ ] **Step 2: Run** `pnpm --filter @mojito/server test docs/docs.integration` → FAIL.
- [ ] **Step 3: Implement** `root.ts`, `list.ts`, `readDocFile` with the signatures above; doc comments in the style of `graph.ts`.
- [ ] **Step 4: Run** the test → PASS; then the whole server suite.
- [ ] **Step 5: Commit** `feat(v2/server): list a project's markdown and a ticket's documents (RIC-506)`.

---

### Task 4: Routes

**Files:**
- Create: `apps/server/src/http/routes/docs.ts`
- Modify: `apps/server/src/http/app.ts` (`AppDeps.docsRead?: DocsReader`; `app.route("/api", docsRoutes(deps))` after `gitGraphRoutes`)
- Test: `apps/server/test/http/docs.test.ts`

**Interfaces:**
- Consumes: Task 3's `readDocList`, `readDocFile`, `DocFileResult`; `isValidTicket`.
- Produces:
  ```ts
  interface DocsReader {
    list(cwd: string, ticket: string | null): Promise<DocList>;
    file(cwd: string, path: string, ticket: string | null): Promise<DocFileResult>;
  }
  function docsReader(home: string): DocsReader; // binds readGit and home
  function docsRoutes(deps: AppDeps): Hono;
  ```
  `GET /projects/:name/docs?ticket=` → `DocList`; `GET /projects/:name/docs/file?path=&ticket=` → `DocFile`.

- [ ] **Step 1: Write the failing tests**, shaped like `test/http/gitGraph.test.ts` (`setup({ docsRead })`, project `{ name: "Web", path: "~/repo/web", teamKey: "RIC" }`, plus a second project named `My Web` for the encoded-space case):
  - list → 200, reader called with `("/home/me/repo/web", null)`; with `ticket=RIC-5` → `"RIC-5"`;
  - `ticket=../x` and `ticket=` → 400, reader not called;
  - unknown project → 404 `{ error }`; path missing on disk (`exists: () => false`) → 400;
  - reader throws `GitError` → 409 with its output (≤ 500 chars); `/api/projects/My%20Web/docs` → 200;
  - file → 200 `DocFile`; `path` missing or empty → 400 without the reader; reader `invalid` → 400, `not-found` → 404, `too-large` → 413, each `{ error }`;
  - no token → 401.
- [ ] **Step 2: Run** `pnpm --filter @mojito/server test http/docs` → FAIL.
- [ ] **Step 3: Implement** `docs.ts` with the same `checkout`/`guarded` helpers as `gitGraph.ts` (copy them; two files do not justify a shared module). Error copy: `invalid ticket`, `path is required`, `not a markdown file in this project`, `document not found`, `document too large`.
- [ ] **Step 4: Run** the test → PASS; `pnpm --filter @mojito/server typecheck`.
- [ ] **Step 5: Commit** `feat(v2/server): docs routes (RIC-506)`.

---

### Task 5: Web pure logic

**Files:**
- Create: `apps/web/src/lib/docs/url.ts`, `apps/web/src/lib/docs/list.ts`, `apps/web/src/lib/docs/links.ts`
- Test: `apps/web/test/lib/docs/url.test.ts`, `list.test.ts`, `links.test.ts`

**Interfaces:**
- Consumes: `DocEntry`, `DocList`, `isDocPath`, `isValidTicket` (shared).
- Produces:
  ```ts
  // url.ts
  interface DocsView { ticket: string | null; path: string | null }
  function parseDocsSearch(params: URLSearchParams): DocsView;           // drops an invalid ticket / non-isDocPath path
  function docsHref(project: string, opts?: { ticket?: string | null; path?: string | null }): string; // strips a leading "./"
  // list.ts
  function docGroups(list: DocList, ticket: string | null): { ticket: DocEntry[] | null; all: DocEntry[] };
  function docLabel(path: string): { name: string; dir: string };       // dir "" at the root
  // links.ts
  type DocHref = { kind: "external"; href: string } | { kind: "mail"; href: string } | { kind: "doc"; path: string } | { kind: "inert" };
  function classifyHref(href: string | undefined, docPath: string): DocHref;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `docsHref("Mojito v2")` → `/docs/Mojito%20v2`; with `{ ticket: "RIC-506", path: "./docs/a.md" }` → `/docs/Mojito%20v2?ticket=RIC-506&path=docs%2Fa.md`; round trip through `parseDocsSearch`; `path=x.txt` and `ticket=../x` parse to null.
  - `docGroups`: no ticket → `{ ticket: null, all: docs }`; with a ticket → `ticket` lists the entries of `ticketDocs` in `docs` order, `all` unchanged; an empty `ticketDocs` → `ticket: []`.
  - `docLabel("docs/superpowers/specs/a.md")` → `{ name: "a.md", dir: "docs/superpowers/specs" }`; `README.md` → dir `""`.
  - `classifyHref`: `https://x` / `HTTP://x` → external; `mailto:a@b` → mail; from `docs/specs/a.md`: `../plans/b.md#step-2` → doc `docs/plans/b.md`, `./c.md` → `docs/specs/c.md`, `c.MD` → `docs/specs/c.MD`, `/abs/d.md` → doc `/abs/d.md`; from `/home/me/r/docs/a.md`: `b.md` → `/home/me/r/docs/b.md`; from `a.md`: `../x.md` → inert (climbs above the root); `#top`, `javascript:alert(1)`, `x.txt`, `undefined` → inert.
- [ ] **Step 2: Run** `pnpm --filter @mojito/web test lib/docs` → FAIL.
- [ ] **Step 3: Implement** the three modules; `classifyHref` collapses `.`/`..` segments itself (no `URL` base trick: a relative root has no origin) and returns inert when a `..` would pop past the first segment of a relative path.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(v2/web): docs url, list and link logic (RIC-506)`.

---

### Task 6: Docs page, data and entry points

**Files:**
- Modify: `apps/web/package.json` (`pnpm --filter @mojito/web add react-markdown remark-gfm @tailwindcss/typography`)
- Modify: `apps/web/src/index.css` (`@plugin "@tailwindcss/typography";` beside the other top-level directives)
- Modify: `apps/web/src/lib/queryKeys.ts` (`docKeys`, with a comment like `gitKeys`')
- Create: `apps/web/src/hooks/useDocs.ts`
- Create: `apps/web/src/components/docs/DocsPage.tsx`, `apps/web/src/components/docs/MarkdownView.tsx`
- Modify: `apps/web/src/routes.tsx` (lazy `/docs/:project`, like `/git/:project`)
- Modify: `apps/web/src/components/board/ProjectSection.tsx`, `apps/web/src/components/sheets/TicketSheet.tsx`, `apps/web/src/components/terminal/TerminalPage.tsx` (entry points)
- Test: `apps/web/test/safeArea.test.ts` (add `["src/components/docs/DocsPage.tsx", "var(--sat)"]` and `var(--sab)`, `var(--sal)`, `var(--sar)` as the git page has)

**Interfaces:**
- Consumes: Task 5's modules; `apiFetch`, `ApiError` (`lib/api.ts`); `useBackOr` (`hooks/useGitGraph.ts`); `relativeTime` (`lib/git/time.ts`); `boardHref` (`lib/boardReturn.ts`).
- Produces:
  ```ts
  const docKeys: {
    project: (project: string) => readonly ["docs", string];
    list: (project: string, ticket: string | null) => readonly ["docs", string, "list", string | null];
    file: (project: string, ticket: string | null, path: string) => readonly ["docs", string, "file", string | null, string];
  };
  function useDocList(project: string, ticket: string | null): UseQueryResult<DocList>;
  function useDocFile(project: string, ticket: string | null, path: string | null): UseQueryResult<DocFile>; // enabled when path
  function DocsPage(): JSX.Element;
  function MarkdownView(props: { content: string; project: string; ticket: string | null; path: string }): JSX.Element;
  ```

- [ ] **Step 1: Add the safe-area rows** to `test/safeArea.test.ts`; run `pnpm --filter @mojito/web test safeArea` → FAIL (file missing).
- [ ] **Step 2: Add the dependencies and the typography plugin**; `pnpm --filter @mojito/web build` still succeeds.
- [ ] **Step 3: Implement `docKeys` and `useDocs.ts`** — both queries `staleTime: Infinity`, `gcTime: 0`, `refetchOnWindowFocus: false`; URLs `/api/projects/${encodeURIComponent(project)}/docs` and `/docs/file?path=…&ticket=…` built with `URLSearchParams`.
- [ ] **Step 4: Implement `MarkdownView`** per spec §3.3: `prose prose-sm sm:prose-base dark:prose-invert max-w-none`; `components.a` via `classifyHref` (external → `target="_blank" rel="noopener noreferrer"`, mail → `<a href>`, doc → `<Link to={docsHref(project, { ticket, path })}>`, inert → `<span>`); `img` → `<span>` with the alt text; `pre` and `table` wrapped in `overflow-x-auto`; no `rehype-raw`.
- [ ] **Step 5: Implement `DocsPage`**, laid out like `GitGraphPage` (sticky header paying `--sat`, `main` paying `--sar/--sab/--sal`, `max-w-3xl` content): list view and document view per spec §3.3, Reload = `qc.resetQueries({ queryKey: docKeys.project(project) })`, error table of spec §3.5 (status from `ApiError`; 409 shows the server's `error`). Rows: `<Link>` `min-h-11`, name then `dir · relativeTime(mtime)` with the dir truncated from the left (`[direction:rtl]` + `text-left` on a `truncate` span, the path wrapped in `<bdi>`). Group headings `RIC-506` and `All documents` only when a ticket is set.
- [ ] **Step 6: Wire the route and the entry points:** `FileText` icon (`size={16}`, `aria-label={\`Docs of ${project}\`}`, `title="Docs"`) after the `GitGraph` icon in `ProjectSection` and `TerminalPage` (same conditions, `ticket: session.ticket`); in `TicketSheet` the `Git` button becomes a two-column `grid grid-cols-2 gap-2` with a `Docs` button (`FileText`) linking to `docsHref(ticket.project, { ticket: ticket.identifier })`, `onClick={onClose}`.
- [ ] **Step 7: Run** `pnpm v2:test && pnpm v2:typecheck` → PASS; `pnpm v2:dev`, open `/docs/Mojito%20v2?ticket=RIC-505` at 320px and check: the RIC-505 group lists the git-graph spec and plan and `CLAUDE.md`; the spec renders with its tables scrolling inside their box; a relative `.md` link inside a doc opens in the viewer; Back steps doc → list → origin; dark mode readable.
- [ ] **Step 8: Commit** `feat(v2/web): docs page with entry points (RIC-506)`.

---

### Task 7: `.md` paths in the terminal

**Files:**
- Modify: `apps/web/src/lib/terminal/links.ts`
- Modify: `apps/web/src/components/terminal/TerminalView.tsx` (prop `openDoc?: (path: string) => void`, provider registration)
- Modify: `apps/web/src/components/terminal/TerminalPage.tsx` (pass `openDoc` when `session.project`)
- Test: `apps/web/test/lib/terminal/links.test.ts`

**Interfaces:**
- Consumes: `docsHref` (Task 5).
- Produces:
  ```ts
  interface FoundLink { kind: "url" | "doc"; text: string; start: RowChar; end: RowChar }
  function findLinks(row: number, getRow: RowReader, cols: number, opts?: { docs?: boolean }): FoundLink[];
  function terminalLinkProvider(term: Terminal, handlers: { openUrl(url: string): void; openDoc?(path: string): void }): ILinkProvider;
  ```
  `urlLinkProvider` is removed (its only caller is `TerminalView`).

Doc matcher (spec §3.4), as a regex over the joined logical line:

```ts
// An optional ~/, / or ./ then segments of [\w.@+-] ending in .md; not glued to a path
// character on the left nor to [\w/] on the right.
const DOC_REGEX = /(?<![\w./~@+-])(?:~\/|\/|\.\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.md(?![\w/])/gi;
```

A match with a `..` segment is skipped; a match overlapping any URL match is dropped; `kind: "doc"` text has a leading `./` removed.

- [ ] **Step 1: Write the failing tests** (existing ones updated to expect `kind: "url"` where they compare whole objects):
  - `"● Write(docs/superpowers/specs/x.md)"` → one doc link `docs/superpowers/specs/x.md`;
  - `` "Spec at `docs/a.md`." `` → `docs/a.md`; `"see docs/a.md:12"` → `docs/a.md`; `"README.md."` → `README.md`; `"./x.md"` → text `x.md`; `"~/notes/x.md"` and `"/home/me/r/x.md"` → as written; `"../x.md"` → none; `"a/b.mdx"` → none;
  - a doc path wrapped by claude over two rows of a 49-column pane (indent 2, body 45) → one link across both rows;
  - `"https://github.com/o/r/blob/main/README.md"` → only the URL;
  - `findLinks(…)` without `{ docs: true }` → no doc links.
- [ ] **Step 2: Run** `pnpm --filter @mojito/web test terminal/links` → FAIL.
- [ ] **Step 3: Implement** in `links.ts` (extend the header comment by one paragraph on doc paths); `TerminalView` registers `terminalLinkProvider(term, { openUrl: (url) => window.open(url, "_blank", "noopener,noreferrer"), openDoc })` reading `openDoc` from a ref so a re-render does not re-register; `TerminalPage` passes `openDoc={(path) => navigate(docsHref(session.project, { ticket: session.ticket, path }))}` only when `session?.project`.
- [ ] **Step 4: Run** `pnpm v2:test && pnpm v2:typecheck` → PASS; in `pnpm v2:dev`, open a session that printed a spec path and tap it → the doc opens; Back → the terminal reattaches.
- [ ] **Step 5: Commit** `feat(v2/web): .md paths in the terminal open the docs viewer (RIC-506)`.

---

### Task 8: Project docs and wrap-up

**Files:**
- Modify: `CLAUDE.md` (Server: a **Docs** bullet after **Git graph**; Web: a **Docs page** bullet after **Git graph page**, and one sentence in the Terminal bullet on `.md` links; Layout: the shared doc types)

- [ ] **Step 1: Write the CLAUDE.md bullets** in the file's dense style: routes and status codes, the root rule (ticket worktree + prefix, else checkout), `ls-files -z` with `.gitignore` and nested worktrees skipped, ticket docs = path token ∪ `git grep -F -w` ∪ branch diff (best-effort), the path guard (400 never 404, realpath, absolute only inside the repo's worktrees), 512 KB → 413; web: `/docs/:project?ticket&path`, `docKeys` outside `qk`, `gcTime: 0`, in-doc link classes, images as alt text, terminal doc links resolved by the server.
- [ ] **Step 2: Run** `pnpm v2:test && pnpm v2:typecheck && pnpm v2:build` → all PASS.
- [ ] **Step 3: Commit** `docs(v2): docs viewer in CLAUDE.md (RIC-506)`.
