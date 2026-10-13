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
