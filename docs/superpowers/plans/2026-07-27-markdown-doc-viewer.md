# Markdown Document Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user read a session's or ticket's worktree markdown (specs, plans, any `.md` the branch touched) rendered inside Mojito, from the terminal view and from the lists.

**Architecture:** A read-only server module (`src/server/docFiles.ts`) discovers markdown under a worktree root and guards every path before reading it. Two GET routes expose listing and content, both resolving their root through one shared target resolver (`src/server/docTarget.ts`) that accepts either a session id or a ticket. On the client a single full-screen overlay component (`DocsView`) shows the list, then the rendered document via `react-markdown`, and is mounted from three entry points.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, vitest, `react-markdown` 10 + `remark-gfm` 4.

## Global Constraints

- All code artifacts in English — identifiers, comments, log and error strings, commit messages.
- Spec of record: `docs/superpowers/specs/2026-07-27-markdown-doc-viewer-design.md`.
- Read-only feature: no route may write, move, or delete a file.
- Every route checks `tokenFromHeaders(req.headers, cfg.token)` first and returns `new NextResponse("unauthorized", { status: 401 })` on failure.
- Server modules under `src/server/` import each other with an explicit `.js` extension (e.g. `from "./worktree.js"`); route files and client files use the `@/` alias without an extension.
- vitest runs with `environment: "node"` and `include: ["tests/**/*.test.ts"]` — **`.tsx` test files are not picked up**, so no React component tests. Test pure logic and routes only.
- Document size cap: `512 * 1024` bytes, exported as `DOC_MAX_BYTES`.
- Directory walk skips `node_modules`, `.git`, `.next`, `.mojito`, and stops at depth 6.
- Dark-only palette: use the existing CSS custom properties in `src/app/globals.css` (`--bg`, `--surface`, `--surface-hi`, `--border`, `--border-hi`, `--text`, `--text-dim`, `--accent`, `--mono`, `--r`, `--r-sm`). No new colour literals.
- Out of scope: relative `.md` links navigating inside the viewer, local images, syntax highlighting, editing.
- Full verification, run at the end of every task: `npx tsc --noEmit && npx vitest run`.
- Commit after each task; no task leaves the tree red.

---

### Task 1: Path guard and document read

**Files:**
- Create: `src/server/docFiles.ts`
- Test: `tests/server/docFiles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DOC_MAX_BYTES: number`, `resolveDocPath(root: string, rel: string): string | null`, `readDoc(abs: string, maxBytes?: number): ReadDocResult` where `ReadDocResult = { ok: true; content: string } | { ok: false; reason: "not-found" | "too-large" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/docFiles.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocPath, readDoc, DOC_MAX_BYTES } from "@/server/docFiles";

let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mojito-docs-"));
  outside = mkdtempSync(join(tmpdir(), "mojito-out-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function write(rel: string, body: string, base = root): string {
  const abs = join(base, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

describe("resolveDocPath", () => {
  it("resolves a markdown file inside the root", () => {
    const abs = write("docs/superpowers/specs/a-design.md", "# a");
    expect(resolveDocPath(root, "docs/superpowers/specs/a-design.md")).toBe(abs);
  });

  it("rejects traversal, absolute paths and empty input", () => {
    write("docs/a.md", "# a");
    expect(resolveDocPath(root, "../escape.md")).toBeNull();
    expect(resolveDocPath(root, "docs/../../escape.md")).toBeNull();
    expect(resolveDocPath(root, join(outside, "escape.md"))).toBeNull();
    expect(resolveDocPath(root, "")).toBeNull();
  });

  it("rejects anything that is not .md", () => {
    write("docs/secret.env", "TOKEN=1");
    expect(resolveDocPath(root, "docs/secret.env")).toBeNull();
    expect(resolveDocPath(root, "docs/a.md.txt")).toBeNull();
  });

  it("accepts an uppercase extension", () => {
    const abs = write("README.MD", "# r");
    expect(resolveDocPath(root, "README.MD")).toBe(abs);
  });

  it("rejects a symlink that escapes the root", () => {
    write("escape.md", "# secret", outside);
    symlinkSync(join(outside, "escape.md"), join(root, "link.md"));
    expect(resolveDocPath(root, "link.md")).toBeNull();
  });

  it("returns a path for a missing file, so the caller reports not-found", () => {
    expect(resolveDocPath(root, "docs/gone.md")).toBe(join(root, "docs/gone.md"));
  });
});

describe("readDoc", () => {
  it("reads the file as utf8", () => {
    const abs = write("a.md", "# heading\n");
    expect(readDoc(abs)).toEqual({ ok: true, content: "# heading\n" });
  });

  it("reports a missing file", () => {
    expect(readDoc(join(root, "gone.md"))).toEqual({ ok: false, reason: "not-found" });
  });

  it("reports a directory as not-found", () => {
    mkdirSync(join(root, "dir.md"));
    expect(readDoc(join(root, "dir.md"))).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses a file over the cap", () => {
    const abs = write("big.md", "x".repeat(40));
    expect(readDoc(abs, 10)).toEqual({ ok: false, reason: "too-large" });
    expect(DOC_MAX_BYTES).toBe(512 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/docFiles.test.ts`
Expected: FAIL — cannot resolve `@/server/docFiles`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/docFiles.ts`:

```ts
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

// Read-only markdown discovery for a worktree. Nothing in this module writes.

export const DOC_MAX_BYTES = 512 * 1024;

export type ReadDocResult =
  | { ok: true; content: string }
  | { ok: false; reason: "not-found" | "too-large" };

function inside(root: string, target: string): boolean {
  // Compare with the separator appended: without it, a sibling directory whose
  // name merely starts with the root's name (…/repo-old vs …/repo) would pass.
  const base = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(base);
}

// The security boundary for the content route: a caller-supplied relative path
// becomes an absolute path only if it stays inside `root` and names a .md file.
// null means "reject with 400" — never "not found".
export function resolveDocPath(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || isAbsolute(rel)) return null;
  if (rel.split(/[\\/]/).includes("..")) return null;
  if (!rel.toLowerCase().endsWith(".md")) return null;
  const abs = resolve(root, rel);
  if (!inside(root, abs)) return null;
  try {
    // Symlinks are only checkable once the target exists. A missing file falls
    // through to the catch and is reported as not-found by readDoc instead.
    const real = realpathSync(abs);
    return inside(realpathSync(root), real) ? real : null;
  } catch {
    return abs;
  }
}

export function readDoc(abs: string, maxBytes = DOC_MAX_BYTES): ReadDocResult {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!st.isFile()) return { ok: false, reason: "not-found" };
  if (st.size > maxBytes) return { ok: false, reason: "too-large" };
  return { ok: true, content: readFileSync(abs, "utf8") };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/docFiles.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/docFiles.ts tests/server/docFiles.test.ts
git commit -m "feat(docs): guard and read a worktree markdown path"
```

---

### Task 2: Superpowers docs discovery

**Files:**
- Modify: `src/server/docFiles.ts` (append)
- Test: `tests/server/docFiles.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's module.
- Produces:
  ```ts
  export interface DocEntry {
    path: string;   // relative to the worktree root, "/" separated
    name: string;   // basename
    source: "specs" | "plans" | "branch";
    mtime: string;  // ISO
    size: number;   // bytes
  }
  export function docEntry(root: string, rel: string, source: DocEntry["source"]): DocEntry | null;
  export function scanSuperpowersDocs(root: string): DocEntry[];
  ```

- [ ] **Step 1: Write the failing test**

Append to `tests/server/docFiles.test.ts` (and extend the import from `@/server/docFiles` with `docEntry, scanSuperpowersDocs`):

```ts
describe("scanSuperpowersDocs", () => {
  it("finds specs and plans at the root and one level down in a monorepo", () => {
    write("docs/superpowers/specs/root-design.md", "# root");
    write("docs/superpowers/plans/root-plan.md", "# plan");
    write("web/docs/superpowers/specs/nested-design.md", "# nested");
    const found = scanSuperpowersDocs(root);
    expect(found.map((d) => d.path).sort()).toEqual([
      "docs/superpowers/plans/root-plan.md",
      "docs/superpowers/specs/root-design.md",
      "web/docs/superpowers/specs/nested-design.md",
    ]);
    expect(found.find((d) => d.path.includes("plans"))!.source).toBe("plans");
    expect(found.find((d) => d.path.endsWith("root-design.md"))!.source).toBe("specs");
    expect(found.find((d) => d.path.endsWith("root-design.md"))!.name).toBe("root-design.md");
  });

  it("ignores non-markdown files and other folders under superpowers", () => {
    write("docs/superpowers/specs/a-design.md", "# a");
    write("docs/superpowers/specs/notes.txt", "x");
    write("docs/superpowers/journal/entry.md", "# j");
    expect(scanSuperpowersDocs(root).map((d) => d.path)).toEqual([
      "docs/superpowers/specs/a-design.md",
    ]);
  });

  it("does not descend into node_modules", () => {
    write("node_modules/pkg/docs/superpowers/specs/dep-design.md", "# dep");
    expect(scanSuperpowersDocs(root)).toEqual([]);
  });

  it("requires the parent directory to be named docs", () => {
    write("superpowers/specs/a-design.md", "# a");
    write("other/superpowers/specs/b-design.md", "# b");
    expect(scanSuperpowersDocs(root)).toEqual([]);
  });

  it("returns an empty list for a missing root", () => {
    expect(scanSuperpowersDocs(join(root, "nope"))).toEqual([]);
  });
});

describe("docEntry", () => {
  it("carries mtime and size", () => {
    write("docs/a.md", "hello");
    const entry = docEntry(root, "docs/a.md", "branch")!;
    expect(entry.size).toBe(5);
    expect(entry.source).toBe("branch");
    expect(Number.isNaN(Date.parse(entry.mtime))).toBe(false);
  });

  it("is null for a path that does not exist", () => {
    expect(docEntry(root, "docs/gone.md", "branch")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/docFiles.test.ts`
Expected: FAIL — `scanSuperpowersDocs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/docFiles.ts`, and extend the `node:fs` / `node:path` imports at the top to
`import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";` and
`import { basename, isAbsolute, join, resolve, sep } from "node:path";`:

```ts
export interface DocEntry {
  path: string;   // relative to the worktree root, "/" separated
  name: string;   // basename
  source: "specs" | "plans" | "branch";
  mtime: string;  // ISO
  size: number;   // bytes
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".mojito"]);
const MAX_DEPTH = 6;

// null when the path is gone or unreadable: `git diff --name-only` reports files
// the branch deleted, and those must not reach the list as dead rows.
export function docEntry(root: string, rel: string, source: DocEntry["source"]): DocEntry | null {
  try {
    const st = statSync(join(root, rel));
    if (!st.isFile()) return null;
    return { path: rel, name: basename(rel), source, mtime: st.mtime.toISOString(), size: st.size };
  } catch {
    return null;
  }
}

function mdFilesIn(root: string, relDir: string, source: DocEntry["source"]): DocEntry[] {
  let names: string[];
  try {
    names = readdirSync(join(root, relDir));
  } catch {
    return []; // that folder simply does not exist in this worktree
  }
  const out: DocEntry[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const entry = docEntry(root, `${relDir}/${name}`, source);
    if (entry) out.push(entry);
  }
  return out;
}

// Walks for `docs/superpowers/{specs,plans}` at any depth up to MAX_DEPTH, so a
// monorepo's web/docs/superpowers/specs is found as well as a root-level one.
export function scanSuperpowersDocs(root: string): DocEntry[] {
  const out: DocEntry[] = [];
  const walk = (relDir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(relDir ? join(root, relDir) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      const childRel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.name === "superpowers" && basename(relDir) === "docs") {
        out.push(...mdFilesIn(root, `${childRel}/specs`, "specs"));
        out.push(...mdFilesIn(root, `${childRel}/plans`, "plans"));
        continue; // nothing deeper under superpowers is listed
      }
      if (depth < MAX_DEPTH) walk(childRel, depth + 1);
    }
  };
  walk("", 0);
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/docFiles.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/docFiles.ts tests/server/docFiles.test.ts
git commit -m "feat(docs): discover superpowers specs and plans in a worktree"
```

---

### Task 3: Branch markdown and the merged listing

**Files:**
- Modify: `src/server/docFiles.ts` (append)
- Test: `tests/server/docFiles.test.ts` (append)

**Interfaces:**
- Consumes: `DocEntry`, `docEntry`, `scanSuperpowersDocs` from Task 2; `detectDefaultBranch` from `src/server/reviewScale.ts` (existing: `detectDefaultBranch(run: (cmd: string, args: string[]) => string): string | null`).
- Produces:
  ```ts
  export type Run = (cmd: string, args: string[]) => string;
  export function branchMdPaths(root: string, run?: Run): string[];
  export function listDocs(root: string, run?: Run): DocEntry[];
  ```

- [ ] **Step 1: Write the failing test**

Append to `tests/server/docFiles.test.ts` (extend the import with `branchMdPaths, listDocs`):

```ts
// A fake git: origin/HEAD points at main, `diff --name-only` returns `out`.
function gitRun(out: string) {
  return (_cmd: string, args: string[]) => {
    if (args.includes("symbolic-ref")) return "origin/main\n";
    if (args.includes("diff")) return out;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

describe("branchMdPaths", () => {
  it("returns the trimmed non-empty lines of the diff", () => {
    expect(branchMdPaths(root, gitRun("AGENTS.md\nweb/notes.md\n\n"))).toEqual([
      "AGENTS.md",
      "web/notes.md",
    ]);
  });

  it("is empty when there is no default branch", () => {
    const run = () => { throw new Error("not a git repo"); };
    expect(branchMdPaths(root, run)).toEqual([]);
  });

  it("is empty when the diff itself fails", () => {
    const run = (_cmd: string, args: string[]) => {
      if (args.includes("symbolic-ref")) return "origin/main\n";
      throw new Error("bad revision");
    };
    expect(branchMdPaths(root, run)).toEqual([]);
  });

  it("asks git for markdown only, against the merge base", () => {
    const seen: string[][] = [];
    const run = (_cmd: string, args: string[]) => {
      seen.push(args);
      return args.includes("symbolic-ref") ? "origin/main\n" : "";
    };
    branchMdPaths(root, run);
    expect(seen.at(-1)).toEqual(["diff", "--name-only", "main...HEAD", "--", "*.md"]);
  });
});

describe("listDocs", () => {
  it("unions both sources, newest first", () => {
    write("docs/superpowers/specs/a-design.md", "# a");
    write("AGENTS.md", "# agents");
    const specPath = join(root, "docs/superpowers/specs/a-design.md");
    const agentsPath = join(root, "AGENTS.md");
    // Make AGENTS.md the newer of the two, deterministically.
    utimesSync(specPath, new Date("2026-07-20T10:00:00Z"), new Date("2026-07-20T10:00:00Z"));
    utimesSync(agentsPath, new Date("2026-07-26T10:00:00Z"), new Date("2026-07-26T10:00:00Z"));
    const docs = listDocs(root, gitRun("AGENTS.md\n"));
    expect(docs.map((d) => [d.path, d.source])).toEqual([
      ["AGENTS.md", "branch"],
      ["docs/superpowers/specs/a-design.md", "specs"],
    ]);
  });

  it("keeps the specs source when the branch also touched the spec", () => {
    write("docs/superpowers/specs/a-design.md", "# a");
    const docs = listDocs(root, gitRun("docs/superpowers/specs/a-design.md\n"));
    expect(docs).toHaveLength(1);
    expect(docs[0].source).toBe("specs");
  });

  it("drops a path the branch deleted", () => {
    expect(listDocs(root, gitRun("removed.md\n"))).toEqual([]);
  });

  it("still lists specs when git is unavailable", () => {
    write("docs/superpowers/specs/a-design.md", "# a");
    const run = () => { throw new Error("no git"); };
    expect(listDocs(root, run).map((d) => d.path)).toEqual(["docs/superpowers/specs/a-design.md"]);
  });
});
```

Extend the `node:fs` import in the test file with `utimesSync`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/docFiles.test.ts`
Expected: FAIL — `branchMdPaths is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/server/docFiles.ts`, adding at the top of the file
`import { execFileSync } from "node:child_process";` and
`import { detectDefaultBranch } from "./reviewScale.js";`:

```ts
export type Run = (cmd: string, args: string[]) => string;

// Markdown the branch created or modified vs the default branch's merge base.
// Best-effort by design: no git, no default branch, no commits yet, or any git
// error yields an empty list so the superpowers scan still shows on its own.
export function branchMdPaths(
  root: string,
  run: Run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }),
): string[] {
  const base = detectDefaultBranch(run);
  if (!base) return [];
  try {
    return run("git", ["diff", "--name-only", `${base}...HEAD`, "--", "*.md"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The listing behind GET /api/docs: superpowers specs/plans plus any markdown the
// branch touched, deduplicated by relative path (the folder wins over the git
// origin) and sorted newest first.
export function listDocs(root: string, run?: Run): DocEntry[] {
  const docs = scanSuperpowersDocs(root);
  const seen = new Set(docs.map((d) => d.path));
  for (const rel of branchMdPaths(root, run)) {
    if (seen.has(rel)) continue;
    const entry = docEntry(root, rel, "branch");
    if (!entry) continue;
    seen.add(rel);
    docs.push(entry);
  }
  return docs.sort((a, b) =>
    a.mtime === b.mtime ? a.path.localeCompare(b.path) : a.mtime < b.mtime ? 1 : -1,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/docFiles.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/docFiles.ts tests/server/docFiles.test.ts
git commit -m "feat(docs): merge branch markdown into the document listing"
```

---

### Task 4: Shared ticket-to-directory resolution

**Files:**
- Create: `src/server/ticketCwd.ts`
- Modify: `src/server/launch.ts:44-51` (replace the body of `defaultResolveCwd`)
- Test: `tests/server/ticketCwd.test.ts`

**Interfaces:**
- Consumes: `parseIdentifier` from `./sessionKey.js`, `loadProjectMap` + `resolveRepoFromMap` from `./limeProjects.js`, `resolveWorktree` from `./worktree.js`.
- Produces: `resolveTicketCwd(projectsPath: string, ticket: string, projectName: string | null): string | null`.

**Why:** `launch.ts` already owns this mapping in a private `defaultResolveCwd`. The docs routes need the same answer for a ticket, so it moves to its own module with no behaviour change. `launch.ts` keeps its `deps.resolveCwd` injection point untouched, so `tests/server/launch.test.ts` and `launchScaling.test.ts` keep passing unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/server/ticketCwd.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTicketCwd } from "@/server/ticketCwd";

let dir: string;
let projectsPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-tcwd-"));
  projectsPath = join(dir, "lime-projects.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function projects(map: Record<string, string>) {
  writeFileSync(projectsPath, JSON.stringify(map));
}

describe("resolveTicketCwd", () => {
  it("returns the repo root when the project maps and no worktree matches", () => {
    const repo = join(dir, "repo");
    mkdirSync(repo);
    projects({ Mojito: repo });
    expect(resolveTicketCwd(projectsPath, "RIC-162", "Mojito")).toBe(repo);
  });

  it("returns null when the project does not map to a repo", () => {
    projects({});
    expect(resolveTicketCwd(projectsPath, "RIC-162", "Unknown")).toBeNull();
  });

  it("returns null for a malformed ticket id instead of throwing", () => {
    projects({ Mojito: dir });
    expect(resolveTicketCwd(projectsPath, "not-a-ticket", "Mojito")).toBeNull();
  });

  it("returns null when the projects file is missing", () => {
    expect(resolveTicketCwd(join(dir, "absent.json"), "RIC-162", "Mojito")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/ticketCwd.test.ts`
Expected: FAIL — cannot resolve `@/server/ticketCwd`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/ticketCwd.ts`:

```ts
import { parseIdentifier } from "./sessionKey.js";
import { loadProjectMap, resolveRepoFromMap } from "./limeProjects.js";
import { resolveWorktree } from "./worktree.js";

// Where a ticket lives on disk: its worktree if one exists, else the repo root.
// Shared by the launcher (a session's spawn cwd) and the docs routes (where to
// look for markdown). null = the ticket maps to no repo at all.
export function resolveTicketCwd(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
): string | null {
  try {
    const { teamKey } = parseIdentifier(ticket);
    const repo = resolveRepoFromMap(loadProjectMap(projectsPath), teamKey, projectName);
    if (!repo) return null;
    return resolveWorktree(repo, ticket) ?? repo;
  } catch {
    // Malformed ticket id, or an unreadable projects file: no directory to offer.
    return null;
  }
}
```

Then in `src/server/launch.ts`, add `import { resolveTicketCwd } from "./ticketCwd.js";` and replace the existing `defaultResolveCwd` (`:44-51`) with a delegating wrapper:

```ts
function defaultResolveCwd(projectsPath: string) {
  return (ticket: string, projectName: string | null): string | null =>
    resolveTicketCwd(projectsPath, ticket, projectName);
}
```

That body held the file's only uses of three imports, so clean them up in the same edit:

- `:6` — drop `parseIdentifier` from the `./sessionKey.js` import (keep `tmuxName`, `validateTicket`, `statusSlug`, `customSessionName`, `rebaseSessionName`, `shellSessionName`).
- `:8` — drop `resolveRepoFromMap` from the `./limeProjects.js` import; **keep** `loadProjectMap` and `resolvePathForProject`, still used at `:183`, `:265`, `:426`, `:481`.
- `:9` — delete the `./worktree.js` import line entirely.

Confirm with `grep -n "parseIdentifier\|resolveRepoFromMap\|resolveWorktree" src/server/launch.ts` — it must print nothing.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/ticketCwd.test.ts tests/server/launch.test.ts tests/server/launchScaling.test.ts && npx tsc --noEmit`
Expected: PASS — the launch tests must be untouched and still green.

- [ ] **Step 5: Commit**

```bash
git add src/server/ticketCwd.ts src/server/launch.ts tests/server/ticketCwd.test.ts
git commit -m "refactor(server): extract resolveTicketCwd for reuse by the docs routes"
```

---

### Task 5: Docs target resolver

**Files:**
- Create: `src/server/docTarget.ts`
- Test: `tests/server/docTarget.test.ts`

**Interfaces:**
- Consumes: `resolveTicketCwd` from Task 4, `SessionMeta` from `./types.js`.
- Produces:
  ```ts
  export interface DocsTargetDeps {
    session: (id: string) => SessionMeta | undefined;  // the registry, in production
    projectsPath: string;                              // lime-projects.json
  }
  export type DocsTargetResult =
    | { ok: true; root: string; label: string }
    | { ok: false; error: string; code: 400 | 404 | 409 };
  export function resolveDocsTarget(url: URL, deps: DocsTargetDeps): DocsTargetResult;
  ```

**Why injected deps rather than reaching for `getRegistry()`/`getConfig()`:** this module would
otherwise import `./app.js`, whose singletons construct a real `Registry` over the real state
directory the moment they are touched. Injection is the seam this codebase already uses for
exactly that reason — `launch.ts` takes a `deps` object, `worktree.ts` and `reviewScale.ts` take
a `run`. It also keeps the test free of module mocking: every existing `vi.mock` in the suite
intercepts a module imported through the `@/` alias from a route, and there is no precedent for
mocking one imported as a relative `./x.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/docTarget.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocsTarget } from "@/server/docTarget";
import type { SessionMeta } from "@/server/types";

let dir: string;
let repo: string;
let projectsPath: string;
let sessions: Record<string, Partial<SessionMeta>>;

// The registry lookup is a plain function here; the project map is a real file,
// so the ticket path exercises resolveTicketCwd for real rather than a mock of it.
const deps = () => ({
  session: (id: string) => sessions[id] as SessionMeta | undefined,
  projectsPath,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-dt-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  projectsPath = join(dir, "lime-projects.json");
  // Keyed by Linear team key — that is what resolveRepoFromMap indexes on.
  writeFileSync(projectsPath, JSON.stringify({ RIC: repo }));
  sessions = {};
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const url = (qs: string) => new URL(`http://localhost/api/docs?${qs}`);

describe("resolveDocsTarget", () => {
  it("resolves a session to its cwd, labelled by ticket", () => {
    sessions["mojito-RIC-162-backlog"] = { cwd: "/wt/RIC-162", ticket: "RIC-162", title: "Submenus" };
    expect(resolveDocsTarget(url("session=mojito-RIC-162-backlog"), deps()))
      .toEqual({ ok: true, root: "/wt/RIC-162", label: "RIC-162" });
  });

  it("labels a ticketless session by its title", () => {
    sessions["mojito-custom-mojito-abc"] = { cwd: "/repo/mojito", ticket: "", title: "mojito" };
    expect(resolveDocsTarget(url("session=mojito-custom-mojito-abc"), deps()))
      .toEqual({ ok: true, root: "/repo/mojito", label: "mojito" });
  });

  it("404s an unknown session", () => {
    expect(resolveDocsTarget(url("session=gone"), deps())).toEqual({
      ok: false, error: "unknown session", code: 404,
    });
  });

  it("400s a session with no working directory", () => {
    sessions["no-cwd"] = { cwd: "", ticket: "RIC-1", title: "t" };
    expect(resolveDocsTarget(url("session=no-cwd"), deps())).toEqual({
      ok: false, error: "session has no working directory", code: 400,
    });
  });

  it("resolves a ticket through the project map to its repo root", () => {
    expect(resolveDocsTarget(url("ticket=RIC-162"), deps()))
      .toEqual({ ok: true, root: repo, label: "RIC-162" });
  });

  it("passes the project through, so a nested project map can be honoured", () => {
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(projectsPath, JSON.stringify({ RIC: { path: repo, projects: { Mojito: other } } }));
    expect(resolveDocsTarget(url("ticket=RIC-162&project=Mojito"), deps()))
      .toEqual({ ok: true, root: other, label: "RIC-162" });
  });

  it("409s a ticket whose team key is not mapped", () => {
    expect(resolveDocsTarget(url("ticket=ZZZ-1"), deps())).toEqual({
      ok: false, error: "no worktree for this ticket", code: 409,
    });
  });

  it("prefers the session when both parameters are present", () => {
    sessions["s"] = { cwd: "/wt/from-session", ticket: "RIC-9", title: "t" };
    expect(resolveDocsTarget(url("session=s&ticket=RIC-162"), deps()))
      .toEqual({ ok: true, root: "/wt/from-session", label: "RIC-9" });
  });

  it("400s when neither session nor ticket is given", () => {
    expect(resolveDocsTarget(url(""), deps())).toEqual({
      ok: false, error: "session or ticket required", code: 400,
    });
  });
});
```

Note: the ticket cases run `resolveWorktree` against a temp directory that is not a git
repository. `resolveWorktree` catches that and falls back to the repo root, which is what those
tests assert; git may print `fatal: not a git repository` to stderr, exactly as it already does
in `tests/server/ticketCwd.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/docTarget.test.ts`
Expected: FAIL — cannot resolve `@/server/docTarget`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/docTarget.ts`:

```ts
import type { SessionMeta } from "./types.js";
import { resolveTicketCwd } from "./ticketCwd.js";

export interface DocsTargetDeps {
  // Look up a live session by its tmux name — the registry, in production.
  session: (id: string) => SessionMeta | undefined;
  // Path to lime-projects.json, for a ticket with no live session.
  projectsPath: string;
}

export type DocsTargetResult =
  | { ok: true; root: string; label: string }
  | { ok: false; error: string; code: 400 | 404 | 409 };

// Both docs routes accept the same two target shapes: a live session (its cwd is
// already the worktree) or a ticket (resolved the way a launch would). One place
// decides, so the two routes cannot drift on status codes. A session wins when
// both are present — it is the more specific answer.
export function resolveDocsTarget(url: URL, deps: DocsTargetDeps): DocsTargetResult {
  const session = url.searchParams.get("session");
  if (session) {
    const meta = deps.session(session);
    if (!meta) return { ok: false, error: "unknown session", code: 404 };
    if (!meta.cwd) return { ok: false, error: "session has no working directory", code: 400 };
    return { ok: true, root: meta.cwd, label: meta.ticket || meta.title };
  }
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const root = resolveTicketCwd(deps.projectsPath, ticket, url.searchParams.get("project"));
    if (!root) return { ok: false, error: "no worktree for this ticket", code: 409 };
    return { ok: true, root, label: ticket };
  }
  return { ok: false, error: "session or ticket required", code: 400 };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/docTarget.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/docTarget.ts tests/server/docTarget.test.ts
git commit -m "feat(docs): resolve a docs target from a session or a ticket"
```

---

### Task 6: The two GET routes

**Files:**
- Create: `src/app/api/docs/route.ts`
- Create: `src/app/api/docs/content/route.ts`
- Test: `tests/server/docsRoute.test.ts`

**Interfaces:**
- Consumes: `resolveDocsTarget` + `docsDeps` (Task 5, the latter added by this task's Step 3), `listDocs` / `resolveDocPath` / `readDoc` (Tasks 1–3), `tokenFromHeaders` from `@/server/auth`, `getConfig` from `@/server/app`.
- Produces: `GET /api/docs` → `{ root, label, files: DocEntry[] }`; `GET /api/docs/content` → `{ path, content }`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/docsRoute.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/docTarget", () => ({
  resolveDocsTarget: vi.fn(),
  // The routes call this for the production wiring; the mocked resolver ignores it.
  docsDeps: vi.fn(() => ({ session: () => undefined, projectsPath: "/projects.json" })),
}));
vi.mock("@/server/docFiles", () => ({
  listDocs: vi.fn(),
  resolveDocPath: vi.fn(),
  readDoc: vi.fn(),
}));

import { GET as LIST } from "@/app/api/docs/route";
import { GET as CONTENT } from "@/app/api/docs/content/route";
import { resolveDocsTarget } from "@/server/docTarget";
import { listDocs, resolveDocPath, readDoc } from "@/server/docFiles";

const TOKEN = "test-token";
function req(qs: string, auth = true): Request {
  return new Request(`http://localhost/api/docs?${qs}`, {
    headers: auth ? { "x-mojito-token": TOKEN } : {},
  });
}

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(resolveDocsTarget).mockReset();
  vi.mocked(listDocs).mockReset();
  vi.mocked(resolveDocPath).mockReset();
  vi.mocked(readDoc).mockReset();
});
afterEach(() => vi.restoreAllMocks());

const okTarget = { ok: true as const, root: "/wt/RIC-162", label: "RIC-162" };

describe("GET /api/docs", () => {
  it("401 without the token", async () => {
    expect((await LIST(req("session=s", false))).status).toBe(401);
  });

  it("200 with root, label and files", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    const files = [{ path: "docs/a.md", name: "a.md", source: "specs", mtime: "2026-07-27T12:00:00.000Z", size: 3 }];
    vi.mocked(listDocs).mockReturnValue(files as never);
    const res = await LIST(req("session=s"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: "/wt/RIC-162", label: "RIC-162", files });
    expect(vi.mocked(listDocs).mock.calls[0][0]).toBe("/wt/RIC-162");
  });

  it("passes the target's error code through", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue({ ok: false, error: "no worktree for this ticket", code: 409 });
    const res = await LIST(req("ticket=RIC-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no worktree for this ticket" });
  });
});

describe("GET /api/docs/content", () => {
  it("401 without the token", async () => {
    expect((await CONTENT(req("session=s&path=docs/a.md", false))).status).toBe(401);
  });

  it("400 without a path", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    expect((await CONTENT(req("session=s"))).status).toBe(400);
  });

  it("400 when the path is rejected by the guard", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue(null);
    const res = await CONTENT(req("session=s&path=../escape.md"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid path" });
  });

  it("200 with the file content", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue("/wt/RIC-162/docs/a.md");
    vi.mocked(readDoc).mockReturnValue({ ok: true, content: "# a" });
    const res = await CONTENT(req("session=s&path=docs/a.md"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "docs/a.md", content: "# a" });
    expect(vi.mocked(resolveDocPath).mock.calls[0]).toEqual(["/wt/RIC-162", "docs/a.md"]);
  });

  it("404 when the file is gone", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue("/wt/RIC-162/docs/a.md");
    vi.mocked(readDoc).mockReturnValue({ ok: false, reason: "not-found" });
    const res = await CONTENT(req("session=s&path=docs/a.md"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "document not found" });
  });

  it("413 when the file is over the cap", async () => {
    vi.mocked(resolveDocsTarget).mockReturnValue(okTarget);
    vi.mocked(resolveDocPath).mockReturnValue("/wt/RIC-162/docs/big.md");
    vi.mocked(readDoc).mockReturnValue({ ok: false, reason: "too-large" });
    const res = await CONTENT(req("session=s&path=docs/big.md"));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "document too large" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/docsRoute.test.ts`
Expected: FAIL — cannot resolve `@/app/api/docs/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/docs/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveDocsTarget } from "@/server/docTarget";
import { listDocs } from "@/server/docFiles";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const target = resolveDocsTarget(new URL(req.url), docsDeps());
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.code });
  return NextResponse.json({ root: target.root, label: target.label, files: listDocs(target.root) });
}
```

Both routes need the same deps object, so put it in `src/server/docTarget.ts` next to its
consumer — it is the one place allowed to touch the app singletons, and it keeps the two routes
from drifting:

```ts
// appended to src/server/docTarget.ts
import { getConfig, getRegistry } from "./app.js";

// The production wiring for resolveDocsTarget. Kept out of the resolver itself so
// tests can pass their own lookup and project map without touching the registry
// singleton or the real state directory.
export function docsDeps(): DocsTargetDeps {
  return { session: (id) => getRegistry().get(id), projectsPath: getConfig().projectsPath };
}
```

Import it in both routes as `import { resolveDocsTarget, docsDeps } from "@/server/docTarget";`.

Create `src/app/api/docs/content/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveDocsTarget } from "@/server/docTarget";
import { resolveDocPath, readDoc } from "@/server/docFiles";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const target = resolveDocsTarget(url, docsDeps());
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.code });
  const rel = url.searchParams.get("path");
  if (!rel) return NextResponse.json({ error: "path required" }, { status: 400 });
  // A rejected path is a 400, never a 404: the guard's null means "not allowed",
  // and saying "not found" would leak whether the file exists.
  const abs = resolveDocPath(target.root, rel);
  if (!abs) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  const read = readDoc(abs);
  if (!read.ok) {
    return read.reason === "too-large"
      ? NextResponse.json({ error: "document too large" }, { status: 413 })
      : NextResponse.json({ error: "document not found" }, { status: 404 });
  }
  return NextResponse.json({ path: rel, content: read.content });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/server/docsRoute.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/docs tests/server/docsRoute.test.ts
git commit -m "feat(api): GET /api/docs and /api/docs/content for worktree markdown"
```

---

### Task 7: Relative timestamps

**Files:**
- Create: `src/lib/relativeTime.ts`
- Test: `tests/lib/relativeTime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `relativeTime(iso: string, now?: Date): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/relativeTime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { relativeTime } from "@/lib/relativeTime";

// Local time throughout: the viewer reads these next to a file name on a phone.
const now = new Date(2026, 6, 27, 16, 30); // 27 Jul 2026, 16:30 local

describe("relativeTime", () => {
  it("shows the clock time for today", () => {
    expect(relativeTime(new Date(2026, 6, 27, 14, 21).toISOString(), now)).toBe("14:21");
  });

  it("pads single-digit hours and minutes", () => {
    expect(relativeTime(new Date(2026, 6, 27, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("says yesterday", () => {
    expect(relativeTime(new Date(2026, 6, 26, 23, 0).toISOString(), now)).toBe("yesterday");
  });

  it("counts days within the week", () => {
    expect(relativeTime(new Date(2026, 6, 24, 8, 0).toISOString(), now)).toBe("3 days");
    expect(relativeTime(new Date(2026, 6, 21, 8, 0).toISOString(), now)).toBe("6 days");
  });

  it("falls back to a day and month beyond a week", () => {
    expect(relativeTime(new Date(2026, 6, 12, 8, 0).toISOString(), now)).toBe("12 Jul");
    expect(relativeTime(new Date(2026, 0, 3, 8, 0).toISOString(), now)).toBe("3 Jan");
  });

  it("shows the clock time for a future stamp rather than negative days", () => {
    expect(relativeTime(new Date(2026, 6, 28, 10, 0).toISOString(), now)).toBe("10:00");
  });

  it("is empty for an unparseable value", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/relativeTime.test.ts`
Expected: FAIL — cannot resolve `@/lib/relativeTime`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/relativeTime.ts`:

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Compact mtime for a document row: "14:21" today, "yesterday", "3 days",
// "12 Jul" beyond a week. Day counts are calendar days, not 24-hour spans, so a
// file written at 23:00 reads as "yesterday" the next morning.
export function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lib/relativeTime.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relativeTime.ts tests/lib/relativeTime.test.ts
git commit -m "feat(lib): relativeTime for document timestamps"
```

---

### Task 8: Markdown renderer and document styles

**Files:**
- Modify: `package.json` (add two dependencies)
- Create: `src/components/MarkdownDoc.tsx`
- Modify: `src/app/globals.css` (append a `.doc-body` block at the end)

**Interfaces:**
- Consumes: `react-markdown`, `remark-gfm`.
- Produces: default export `MarkdownDoc({ content }: { content: string })`, rendering into `<div className="doc-body">`.

**Note:** vitest cannot cover this file (no `.tsx` tests, `environment: "node"`). It is verified by `npx tsc --noEmit`, `npx next build`, and by Task 10's manual check in the browser.

- [ ] **Step 1: Install the dependencies**

Run: `npm install react-markdown@^10.1.0 remark-gfm@^4.0.1`
Expected: both land in `dependencies` in `package.json`.

- [ ] **Step 2: Write the component**

Create `src/components/MarkdownDoc.tsx`:

```tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// react-markdown does not render raw HTML embedded in the markdown unless
// rehype-raw is added, so there is no dangerouslySetInnerHTML here and no
// sanitizer to keep in step with it.
export default function MarkdownDoc({ content }: { content: string }) {
  return (
    <div className="doc-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // http(s) leaves for a new tab, same rule as the terminal's WebLinksAddon.
          // mailto stays a plain link. Anything else — a relative path, a bare
          // #anchor, a missing href — renders inert: relative .md navigation is out
          // of scope here, and letting the browser follow it would leave the SPA for
          // a 404, tearing down the live terminal behind the viewer.
          a: ({ href, title, children }) => {
            const scheme = (href ?? "").toLowerCase();
            const external = scheme.startsWith("http://") || scheme.startsWith("https://");
            if (external) {
              return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>;
            }
            if (scheme.startsWith("mailto:")) return <a href={href} title={title}>{children}</a>;
            return <a title={title}>{children}</a>;
          },
          // A wide table must scroll inside its own box; the page never pans.
          table: ({ children }) => <div className="doc-table"><table>{children}</table></div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: Append the styles**

Append to `src/app/globals.css`:

```css
/* ---- Rendered markdown document ---- */
.doc-body { padding: 14px 16px 48px; font-size: 15px; line-height: 1.6; color: var(--text); }
.doc-body > :first-child { margin-top: 0; }
.doc-body h1 { font-size: 22px; line-height: 1.25; margin: 24px 0 10px; letter-spacing: -.01em; }
.doc-body h2 { font-size: 18px; margin: 22px 0 8px; color: var(--accent); }
.doc-body h3 { font-size: 16px; margin: 18px 0 6px; }
.doc-body h4 { font-size: 14px; margin: 16px 0 6px; color: var(--text-dim); }
.doc-body p { margin: 0 0 12px; }
.doc-body ul, .doc-body ol { margin: 0 0 12px; padding-left: 22px; }
.doc-body li { margin: 4px 0; }
.doc-body li > input[type="checkbox"] { margin-right: 6px; }
.doc-body a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px;
  word-break: break-word; }
.doc-body code { font: 500 13px var(--mono); background: var(--surface-hi);
  border: 1px solid var(--border); border-radius: 6px; padding: 1px 5px; word-break: break-word; }
.doc-body pre { background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-sm); padding: 12px; margin: 0 0 14px; overflow-x: auto; }
.doc-body pre code { background: none; border: none; padding: 0; font-size: 12.5px;
  line-height: 1.5; white-space: pre; }
.doc-body blockquote { margin: 0 0 12px; padding: 2px 0 2px 12px;
  border-left: 3px solid var(--border-hi); color: var(--text-dim); }
.doc-body hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.doc-body img { max-width: 100%; }
.doc-table { overflow-x: auto; margin: 0 0 14px; }
.doc-table table { border-collapse: collapse; font-size: 13px; }
.doc-table th, .doc-table td { border: 1px solid var(--border); padding: 6px 10px;
  text-align: left; vertical-align: top; }
.doc-table th { background: var(--surface-hi); font-weight: 700; white-space: nowrap; }
```

- [ ] **Step 4: Verify types and the build**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/MarkdownDoc.tsx src/app/globals.css
git commit -m "feat(ui): render markdown with react-markdown and gfm"
```

---

### Task 9: The docs overlay

**Files:**
- Create: `src/lib/useDocs.ts`
- Create: `src/components/DocsView.tsx`
- Modify: `src/app/globals.css` (append the `.docs-*` block)

**Interfaces:**
- Consumes: `apiFetch` from `@/lib/client`, `relativeTime` (Task 7), `MarkdownDoc` (Task 8), the two routes (Task 6).
- Produces:
  ```ts
  // src/lib/useDocs.ts
  export interface DocEntry { path: string; name: string; source: "specs" | "plans" | "branch"; mtime: string; size: number }
  export type DocsTarget = { session: string } | { ticket: string; project: string | null };
  export function targetQuery(t: DocsTarget): string;
  export function listErrorMessage(status: number): string;
  export function docErrorMessage(status: number): string;
  export function useDocList(token: string, target: DocsTarget): { files: DocEntry[] | null; error: string | null };
  export function useDocContent(token: string, target: DocsTarget, path: string | null, reload: number):
    { content: string | null; error: string | null };
  // src/components/DocsView.tsx
  export default function DocsView(props: { token: string; target: DocsTarget; label: string; onClose: () => void }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test for the one pure piece**

`useDocList` / `useDocContent` are hooks and `DocsView` is a component, neither testable under `environment: "node"` with `.ts`-only test discovery. The pure pieces are `targetQuery` — which would silently break both routes if it were wrong — and the two status-to-message maps that carry the spec's error copy. Test those.

Create `tests/lib/useDocs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { targetQuery, listErrorMessage, docErrorMessage } from "@/lib/useDocs";

describe("targetQuery", () => {
  it("builds a session query", () => {
    expect(targetQuery({ session: "mojito-RIC-162-backlog" })).toBe("session=mojito-RIC-162-backlog");
  });

  it("builds a ticket query with its project", () => {
    expect(targetQuery({ ticket: "RIC-162", project: "Mojito" })).toBe("ticket=RIC-162&project=Mojito");
  });

  it("omits an absent project", () => {
    expect(targetQuery({ ticket: "RIC-162", project: null })).toBe("ticket=RIC-162");
  });

  it("encodes a project name with spaces", () => {
    expect(targetQuery({ ticket: "RIC-1", project: "Factory Book" })).toBe("ticket=RIC-1&project=Factory+Book");
  });
});

describe("listErrorMessage", () => {
  it("names the ticket-with-no-worktree case", () => {
    expect(listErrorMessage(409)).toBe("No worktree for this ticket.");
  });
  it("names the session cases", () => {
    expect(listErrorMessage(404)).toBe("This session is gone.");
    expect(listErrorMessage(400)).toBe("This session has no working directory.");
  });
  it("falls back for anything else", () => {
    expect(listErrorMessage(401)).toBe("Could not load documents.");
    expect(listErrorMessage(500)).toBe("Could not load documents.");
  });
});

describe("docErrorMessage", () => {
  it("covers the document cases from the spec's error table", () => {
    expect(docErrorMessage(404)).toBe("Document not found.");
    expect(docErrorMessage(413)).toBe("Document too large to display.");
    expect(docErrorMessage(400)).toBe("Invalid document path.");
  });
  it("falls back for anything else", () => {
    expect(docErrorMessage(500)).toBe("Could not load the document.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/useDocs.test.ts`
Expected: FAIL — cannot resolve `@/lib/useDocs`.

- [ ] **Step 3: Write the hooks**

Create `src/lib/useDocs.ts`:

```ts
"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./client";

// Mirrors DocEntry in src/server/docFiles.ts. Declared again rather than imported:
// that module reaches for node:fs and node:child_process at load time and has no
// business anywhere near the browser bundle.
export interface DocEntry {
  path: string;
  name: string;
  source: "specs" | "plans" | "branch";
  mtime: string;
  size: number;
}

// A docs request is scoped either to a live session (its cwd is the worktree) or
// to a ticket (the server resolves the worktree the way a launch would).
export type DocsTarget = { session: string } | { ticket: string; project: string | null };

export function targetQuery(t: DocsTarget): string {
  const p = new URLSearchParams();
  if ("session" in t) p.set("session", t.session);
  else {
    p.set("ticket", t.ticket);
    if (t.project) p.set("project", t.project);
  }
  return p.toString();
}

// The routes answer with lowercase API strings ("no worktree for this ticket");
// these are the sentences the user reads. Mapping by status keeps the two apart,
// so an API wording change cannot rewrite the UI copy by accident.
export function listErrorMessage(status: number): string {
  if (status === 409) return "No worktree for this ticket.";
  if (status === 404) return "This session is gone.";
  if (status === 400) return "This session has no working directory.";
  return "Could not load documents.";
}

export function docErrorMessage(status: number): string {
  if (status === 404) return "Document not found.";
  if (status === 413) return "Document too large to display.";
  if (status === 400) return "Invalid document path.";
  return "Could not load the document.";
}

export function useDocList(token: string, target: DocsTarget) {
  const [files, setFiles] = useState<DocEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Depend on the serialised query, not the target object: a fresh object
  // literal on every render would re-fetch forever.
  const q = targetQuery(target);
  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(null);
    apiFetch(token, `/api/docs?${q}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(listErrorMessage(res.status));
        else setFiles(((await res.json()).files ?? []) as DocEntry[]);
      })
      .catch(() => { if (alive) setError("Could not load documents."); });
    return () => { alive = false; };
  }, [token, q]);
  return { files, error };
}

// `reload` is a counter the caller bumps to re-fetch the same path — a spec can be
// rewritten by the session while it is on screen.
export function useDocContent(token: string, target: DocsTarget, path: string | null, reload: number) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = targetQuery(target);
  useEffect(() => {
    if (!path) { setContent(null); setError(null); return; }
    let alive = true;
    setContent(null);
    setError(null);
    apiFetch(token, `/api/docs/content?${q}&path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(docErrorMessage(res.status));
        else setContent((await res.json()).content as string);
      })
      .catch(() => { if (alive) setError("Could not load the document."); });
    return () => { alive = false; };
  }, [token, q, path, reload]);
  return { content, error };
}
```

- [ ] **Step 4: Write the overlay component**

Create `src/components/DocsView.tsx`:

```tsx
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useDocList, useDocContent, type DocsTarget } from "@/lib/useDocs";
import { relativeTime } from "@/lib/relativeTime";

// The markdown parser is ~70 KB of JS that only matters once a document is
// opened; keep it out of the first paint, as page.tsx does for TerminalView.
const MarkdownDoc = dynamic(() => import("./MarkdownDoc"), { ssr: false });

export default function DocsView(
  { token, target, label, onClose }:
  { token: string; target: DocsTarget; label: string; onClose: () => void },
) {
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { files, error: listError } = useDocList(token, target);
  const { content, error: docError } = useDocContent(token, target, selected, reload);
  const current = files?.find((f) => f.path === selected);

  return (
    <div className="docs-root">
      <header className="docs-head">
        <button className="back" aria-label="Back" onClick={() => (selected ? setSelected(null) : onClose())}>‹</button>
        <span className="name">{selected ? (current?.name ?? selected) : `${label} · docs`}</span>
        <span className="grow" />
        {selected && (
          <button className="btn sm" aria-label="Reload" onClick={() => setReload((n) => n + 1)}>↻</button>
        )}
      </header>
      <div className="docs-scroll">
        {selected ? (
          docError ? <p className="empty">{docError}</p>
          : content === null ? <p className="empty">Loading…</p>
          : <MarkdownDoc content={content} />
        ) : listError ? <p className="empty">{listError}</p>
        : files === null ? <p className="empty">Loading…</p>
        : files.length === 0 ? <p className="empty">No documents yet.</p>
        : files.map((f) => (
          <button key={f.path} className="docs-item" onClick={() => setSelected(f.path)}>
            <div className="name">{f.name}</div>
            <div className="meta">{f.source} · {relativeTime(f.mtime)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Append the shell styles**

Append to `src/app/globals.css`:

```css
/* ---- Docs overlay ---- */
/* Above the terminal (z-index 100 is the sheet backdrop): the terminal stays
   mounted underneath so its WebSocket is never closed. */
.docs-root { position: fixed; inset: 0; z-index: 120; display: flex; flex-direction: column;
  background: var(--bg); }
.docs-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  border-bottom: 1px solid var(--border); background: var(--surface); }
.docs-head .back { width: 32px; height: 32px; border-radius: 8px; background: var(--surface-hi);
  border: 1px solid var(--border-hi); color: var(--text); font-size: 18px; cursor: pointer; flex: none; }
.docs-head .name { font: 600 13px/1.3 var(--mono); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.docs-scroll { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain; }
.docs-item { display: block; margin: 10px 14px; padding: 12px 14px; text-align: left;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r);
  color: var(--text); cursor: pointer; }
.docs-item:active { transform: scale(.99); }
.docs-item .name { font: 600 13px/1.35 var(--mono); word-break: break-all; }
.docs-item .meta { margin-top: 6px; font: 500 12px var(--mono); color: var(--text-dim); }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/lib/useDocs.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/useDocs.ts src/components/DocsView.tsx src/app/globals.css tests/lib/useDocs.test.ts
git commit -m "feat(ui): DocsView overlay listing and rendering worktree markdown"
```

---

### Task 10: Wire the three entry points

**Files:**
- Modify: `src/components/TerminalView.tsx` (header button + overlay, around `:358-380`)
- Modify: `src/components/SessionList.tsx` (card action row, around `:131-136`)
- Modify: `src/components/LaunchSheet.tsx` (new prop + button before the error line, around `:138-183`)
- Modify: `src/components/TicketList.tsx` (pass the prop through to `LaunchSheet`, around `:97-100`)
- Modify: `src/app/page.tsx` (page-level docs state)

**Interfaces:**
- Consumes: `DocsView`, `DocsTarget` (Task 9).
- Produces: no new exports. New props: `SessionList` gains `onOpenDocs: (s: SessionMeta) => void`; `TicketList` gains `onOpenDocs: (t: TicketSummary) => void`; `LaunchSheet` gains `onOpenDocs: () => void`.

- [ ] **Step 1: Add the terminal entry point**

In `src/components/TerminalView.tsx`, add to the imports:

```tsx
import DocsView from "./DocsView";
```

Add to the state declarations next to `const [imgErr, setImgErr] = useState<string | null>(null);`:

```tsx
const [docsOpen, setDocsOpen] = useState(false);
```

In the header, immediately before the `auto:` toggle button:

```tsx
<button className="btn sm" aria-label="Documents" onClick={() => setDocsOpen(true)}>📄</button>
```

And as the last child of the `.term-root` div, after `<AccessoryBar … />`:

```tsx
{docsOpen && (
  <DocsView
    token={token}
    target={{ session: session.id }}
    label={session.ticket || session.title}
    onClose={() => setDocsOpen(false)}
  />
)}
```

The overlay is rendered inside `TerminalView` on purpose: the terminal stays mounted, so closing the overlay costs no WebSocket reconnect and no scrollback replay.

- [ ] **Step 2: Add the list entry points**

In `src/components/SessionList.tsx`, add `onOpenDocs` to the props type and destructuring:

```tsx
{ token, sessions, onOpen, onChanged, onOpenDocs }:
{ token: string; sessions: SessionMeta[]; onOpen: (s: SessionMeta) => void; onChanged: () => void;
  onOpenDocs: (s: SessionMeta) => void },
```

and add a button to the card's action row, between `Open` and the kill button:

```tsx
<button className="btn ghost sm" onClick={() => onOpenDocs(s)}>Docs</button>
```

In `src/components/LaunchSheet.tsx`, add `onOpenDocs` to the props type and destructuring:

```tsx
{ token, ticket, sessions, onClose, onLaunched, onOpen, onOpenDocs }:
{ token: string; ticket: TicketSummary; sessions: SessionMeta[]; onClose: () => void;
  onLaunched: () => void; onOpen: (s: SessionMeta) => void; onOpenDocs: () => void },
```

and add a button as the last element before `{err && …}`:

```tsx
<button className="btn ghost block" style={{ marginTop: 12 }} onClick={onOpenDocs}>Docs</button>
```

In `src/components/TicketList.tsx`, add `onOpenDocs` to the props type and destructuring:

```tsx
{ token, tickets, sessions, onLaunched, onOpen, onOpenDocs }:
{ token: string; tickets: TicketSummary[]; sessions: SessionMeta[]; onLaunched: () => void;
  onOpen: (s: SessionMeta) => void; onOpenDocs: (t: TicketSummary) => void },
```

and pass it to `LaunchSheet`:

```tsx
<LaunchSheet token={token} ticket={picked} sessions={sessions}
  onClose={() => setPicked(null)} onLaunched={onLaunched}
  onOpen={(s) => { setPicked(null); onOpen(s); }}
  onOpenDocs={() => { setPicked(null); onOpenDocs(picked); }} />
```

- [ ] **Step 3: Hold the docs target in the page**

In `src/app/page.tsx`, add the imports:

```tsx
import DocsView from "@/components/DocsView";
import type { DocsTarget } from "@/lib/useDocs";
```

Add the state next to `const [settingsOpen, setSettingsOpen] = useState(false);`:

```tsx
const [docsFor, setDocsFor] = useState<{ target: DocsTarget; label: string } | null>(null);
```

Add the render branch immediately after the `if (open) return <TerminalView … />` line — the overlay opened from a list replaces the page, since there is no terminal to keep alive here:

```tsx
if (docsFor) {
  return (
    <DocsView token={token} target={docsFor.target} label={docsFor.label} onClose={() => setDocsFor(null)} />
  );
}
```

Then pass the two new props where the lists are rendered:

```tsx
? <TicketList token={token} tickets={tickets} sessions={sessions}
    onLaunched={() => { refreshSessions(); refreshTickets(); }} onOpen={setOpen}
    onOpenDocs={(t) => setDocsFor({ target: { ticket: t.identifier, project: t.project }, label: t.identifier })} />
```

```tsx
: <SessionList token={token} sessions={sessions} onOpen={setOpen} onChanged={refreshSessions}
    onOpenDocs={(s) => setDocsFor({ target: { session: s.id }, label: s.ticket || s.title })} />
```

- [ ] **Step 4: Verify types, tests and the production build**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: no type errors, every test passes, the build succeeds.

- [ ] **Step 5: Check it in the browser**

Run the dev server (`npm run dev`) and, against a real ticket that has a spec in its worktree:

1. Open the ticket's session terminal → tap 📄 → the spec is listed with `specs · <time>` → tap it → it renders with headings, lists, code blocks and tables.
2. Tap `‹` → back to the list. Tap `‹` again → back to the terminal, **still connected and showing the same transcript** (no reconnect flash, no repeated scrollback).
3. Tap `↻` on an open document while a session rewrites it → the new content appears.
4. From the Sessions tab, tap `Docs` on a card → same list, `‹` returns to the list.
5. From the Tickets tab, open a ticket whose session was already retired → `Docs` → the spec is still readable.
6. A ticket with no worktree → "No worktree for this ticket." A worktree with no markdown → "No documents yet."

- [ ] **Step 6: Commit**

```bash
git add src/components/TerminalView.tsx src/components/SessionList.tsx src/components/LaunchSheet.tsx src/components/TicketList.tsx src/app/page.tsx
git commit -m "feat(ui): open the docs viewer from the terminal, sessions and tickets"
```

---

## Verification summary

- `npx tsc --noEmit && npx vitest run` green after every task.
- `npx next build` green after Tasks 8 and 10 (the only tasks that add client code the compiler alone cannot fully vouch for).
- Task 10 Step 5 is the manual pass: it is the only check that the terminal survives the overlay round trip, which is the whole reason `DocsView` is mounted inside `TerminalView` rather than in the page.
