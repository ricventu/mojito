import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectDefaultBranch } from "./merge";
import { parseWorktrees } from "./worktree";

// Reads a repo's commit graph for the git graph view. Pure parsers up top, the git calls
// below over an injected runner — the split worktree.ts uses — so every format detail is
// testable against strings and one integration test checks them against real git.

export type GitText = (args: string[]) => Promise<string>;

export interface GraphRef {
  name: string;
  kind: "local" | "remote" | "tag";
  // Checked out in some worktree (the main checkout included).
  worktree?: true;
  // …and that worktree is one Mojito created, under <repo>/.claude/worktrees/.
  mojito?: true;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: GraphRef[];
}

export interface RefEntry { hash: string; ref: GraphRef }

export interface CommitFile { status: string; path: string; from?: string }

export const PAGE_SIZE = 200;
export const MAX_FILES = 300;

// NUL between fields and RS after each record: no subject character can break the parse,
// where `%D` or a printable separator could.
export const LOG_FORMAT = "%H%x00%P%x00%an%x00%aI%x00%s%x1e";

export function parseLog(out: string): Omit<GraphCommit, "refs">[] {
  return out
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r !== "")
    .map((r) => {
      const [hash, parents, author, date, subject] = r.split("\x00");
      return { hash, parents: parents ? parents.split(" ") : [], author, date, subject: subject ?? "" };
    });
}

// `for-each-ref --format=%(objectname)%00%(*objectname)%00%(refname)`. The middle field
// is set only for an annotated tag, and is the commit it points at — the tag object's own
// hash is in no commit's history, so a tag keyed on it would never be drawn.
export function parseRefs(out: string): RefEntry[] {
  const entries: RefEntry[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [obj, peeled, refname] = line.split("\x00");
    const hash = peeled || obj;
    if (refname.startsWith("refs/heads/")) {
      entries.push({ hash, ref: { name: refname.slice("refs/heads/".length), kind: "local" } });
    } else if (refname.startsWith("refs/remotes/")) {
      const name = refname.slice("refs/remotes/".length);
      // A symref onto a branch already listed — the same commit twice under a name that
      // hides which branch it is.
      if (name.endsWith("/HEAD")) continue;
      entries.push({ hash, ref: { name, kind: "remote" } });
    } else if (refname.startsWith("refs/tags/")) {
      entries.push({ hash, ref: { name: refname.slice("refs/tags/".length), kind: "tag" } });
    }
  }
  return entries;
}

export function markWorktrees(
  entries: RefEntry[],
  worktrees: { path: string; branch: string; prunable?: boolean }[],
): RefEntry[] {
  const live = worktrees.filter((w) => !w.prunable && w.branch !== "");
  return entries.map((e) => {
    if (e.ref.kind !== "local") return e;
    const wt = live.find((w) => w.branch === e.ref.name);
    if (!wt) return e;
    const ref: GraphRef = { ...e.ref, worktree: true };
    if (wt.path.includes("/.claude/worktrees/")) ref.mojito = true;
    return { hash: e.hash, ref };
  });
}

const KIND_ORDER: Record<GraphRef["kind"], number> = { local: 0, remote: 1, tag: 2 };

export function attachRefs(commits: Omit<GraphCommit, "refs">[], entries: RefEntry[]): GraphCommit[] {
  const byHash = new Map<string, GraphRef[]>();
  for (const e of entries) {
    const list = byHash.get(e.hash) ?? [];
    list.push(e.ref);
    byHash.set(e.hash, list);
  }
  return commits.map((c) => ({
    ...c,
    refs: (byHash.get(c.hash) ?? []).slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
  }));
}

export function parseCounts(out: string): { behind: number; ahead: number } {
  const [left, right] = out.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
  return { behind: left || 0, ahead: right || 0 };
}

// `show --name-status -z`: NUL-separated tokens, a status code followed by one path, or
// two for a rename/copy (R087 old new). -z because without it git C-quotes any path with
// a tab, quote or non-ASCII byte.
export function parseNameStatus(out: string): CommitFile[] {
  const tokens = out.replace(/^[\n\0]+/, "").split("\0");
  const files: CommitFile[] = [];
  let i = 0;
  while (i < tokens.length && tokens[i] !== "") {
    const status = tokens[i][0];
    if (status === "R" || status === "C") {
      files.push({ status, from: tokens[i + 1], path: tokens[i + 2] });
      i += 3;
    } else {
      files.push({ status, path: tokens[i + 1] });
      i += 2;
    }
  }
  return files;
}

// Full or abbreviated lowercase hex only. Anything else never reaches git, so a query
// parameter cannot become a flag or a rev expression.
export function isValidHash(s: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(s);
}

const pexec = promisify(execFile);

// Read-only and local, so no credential plumbing: LC_ALL=C pins git's output to English,
// as merge.ts does, and 10s bounds a huge repo without wedging the request.
function defaultRun(cwd: string): GitText {
  return async (args) => (await pexec("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  })).stdout;
}

async function attempt(run: GitText, args: string[]): Promise<string | null> {
  try {
    return (await run(args)).trim() || null;
  } catch {
    return null;
  }
}

export interface GraphHighlight {
  branch: string;
  tip: string;
  base: string;
  baseTip: string;
  ahead: number;
  behind: number;
  merged: boolean;
}

export interface GitGraph {
  head: string | null;
  highlight: GraphHighlight | null;
  commits: GraphCommit[];
  hasMore: boolean;
}

export interface CommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  message: string;
  files: CommitFile[];
  moreFiles: number;
}

const REF_NAMESPACES = ["refs/heads", "refs/remotes/origin", "refs/tags"];

export async function readGitGraph(
  cwd: string,
  opts: { skip: number; highlight: string | null },
  run: GitText = defaultRun(cwd),
): Promise<GitGraph> {
  // Unguarded: in a directory that is not a repo this is the call that fails, and the
  // route turns the failure into a 409 carrying git's own words.
  const refOut = await run(["for-each-ref", "--format=%(objectname)%00%(*objectname)%00%(refname)", ...REF_NAMESPACES]);
  const head = await attempt(run, ["rev-parse", "--verify", "-q", "HEAD"]);
  let worktrees: ReturnType<typeof parseWorktrees> = [];
  try { worktrees = parseWorktrees(await run(["worktree", "list", "--porcelain"])); } catch { /* no badges */ }
  const entries = markWorktrees(parseRefs(refOut), worktrees);

  // A repo with no commits has neither refs nor a HEAD, and `git log` would fail on it.
  if (entries.length === 0 && head === null) return { head, highlight: null, commits: [], hasMore: false };

  const revs = ["--branches", "--remotes=origin", "--tags", ...(head ? ["HEAD"] : [])];
  const logOut = await run([
    "log", "--topo-order", `--format=${LOG_FORMAT}`, `--skip=${opts.skip}`, "-n", String(PAGE_SIZE + 1), ...revs, "--",
  ]);
  const parsed = parseLog(logOut);
  const commits = attachRefs(parsed.slice(0, PAGE_SIZE), entries);
  const highlight = opts.skip === 0 && opts.highlight ? await highlightStats(cwd, opts.highlight, run) : null;
  return { head, highlight, commits, hasMore: parsed.length > PAGE_SIZE };
}

async function highlightStats(cwd: string, branch: string, run: GitText): Promise<GraphHighlight | null> {
  const tip = await attempt(run, ["rev-parse", "--verify", "-q", `refs/heads/${branch}^{commit}`]);
  if (!tip) return null;
  let def: string | null = null;
  try {
    def = await detectDefaultBranch(cwd, async (args) => ({ stdout: await run(args), stderr: "" }));
  } catch { /* no default branch: the strip names the branch alone */ }
  const none: GraphHighlight = { branch, tip, base: "", baseTip: "", ahead: 0, behind: 0, merged: false };
  if (!def) return none;
  for (const [ref, base] of [[`refs/remotes/origin/${def}`, `origin/${def}`], [`refs/heads/${def}`, def]]) {
    // The default branch measured against itself says nothing.
    if (base === branch) continue;
    const baseTip = await attempt(run, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
    if (!baseTip) continue;
    const { ahead, behind } = parseCounts(await run(["rev-list", "--left-right", "--count", `${baseTip}...${tip}`]));
    return { branch, tip, base, baseTip, ahead, behind, merged: ahead === 0 };
  }
  return none;
}

export async function readCommit(cwd: string, hash: string, run: GitText = defaultRun(cwd)): Promise<CommitDetails | null> {
  if (!isValidHash(hash)) throw new Error("invalid hash");
  const full = await attempt(run, ["rev-parse", "--verify", "-q", `${hash}^{commit}`]);
  if (!full) return null;
  const meta = await run(["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B", full]);
  const [h, parents, author, email, date, message] = meta.split("\x00");
  // A merge lists what it brought in against its first parent — what `git log -p` on the
  // mainline would show — rather than the combined diff, which lists only conflicts.
  const files = parseNameStatus(await run(["show", "--format=", "--name-status", "-z", "-M", "--diff-merges=first-parent", full]));
  return {
    hash: h,
    parents: parents ? parents.split(" ") : [],
    author,
    email,
    date,
    message: (message ?? "").trimEnd(),
    files: files.slice(0, MAX_FILES),
    moreFiles: Math.max(0, files.length - MAX_FILES),
  };
}
