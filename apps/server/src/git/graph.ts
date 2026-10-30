import type { GraphCommit, GraphRef } from "@mojito/shared";

// The pure half of the git graph: parsers for what git prints, over the strings the git calls
// return. The calls themselves live below them, over an injected `GitRun` (the split sync.ts uses).

/** One commit per record: RS ends a record and NUL splits its fields, so no subject can break the parse. */
export const LOG_FORMAT = "%H%x00%P%x00%an%x00%aI%x00%s%x1e";

/** The object, its peeled commit when it is an annotated tag, the name and the committer date. */
export const REF_FORMAT = "%(objectname)%00%(*objectname)%00%(refname)%00%(committerdate:unix)";

/** Commits per page; git is asked for one more, which only says whether there is a next page. */
export const PAGE_SIZE = 200;

export interface RefEntry {
  /** The commit the ref points at, peeled for an annotated tag. */
  hash: string;
  ref: GraphRef;
  /** Committer date in unix seconds; 0 when git gave none. */
  date: number;
}

export function parseLog(out: string): Omit<GraphCommit, "refs">[] {
  return out
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record !== "")
    .map((record) => {
      const [hash = "", parents = "", author = "", date = "", subject = ""] = record.split("\x00");
      return { hash, parents: parents.split(" ").filter(Boolean), author, date, subject };
    });
}

/** Annotated tags map to their peeled commit (the tag object is in no history); `origin/HEAD` is dropped. */
export function parseRefs(out: string): RefEntry[] {
  const entries: RefEntry[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [object = "", peeled = "", refname = "", date = ""] = line.split("\x00");
    const ref = toRef(refname);
    if (ref) entries.push({ hash: peeled || object, ref, date: Number(date) || 0 });
  }
  return entries;
}

function toRef(refname: string): GraphRef | null {
  if (refname.startsWith("refs/heads/")) return { name: refname.slice("refs/heads/".length), kind: "local" };
  if (refname.startsWith("refs/remotes/")) {
    const name = refname.slice("refs/remotes/".length);
    return name.endsWith("/HEAD") ? null : { name, kind: "remote" };
  }
  if (refname.startsWith("refs/tags/")) return { name: refname.slice("refs/tags/".length), kind: "tag" };
  return null;
}

/** A local branch checked out in a live (non-prunable) worktree gets `worktree: true`. */
export function markWorktrees(entries: RefEntry[], worktrees: { branch: string; prunable: boolean }[]): RefEntry[] {
  const checkedOut = new Set(worktrees.filter((w) => w.branch && !w.prunable).map((w) => w.branch));
  return entries.map((e) => (e.ref.kind === "local" && checkedOut.has(e.ref.name) ? { ...e, ref: { ...e.ref, worktree: true } } : e));
}

/** `worktree list --porcelain`: blocks separated by a blank line; a detached head has no branch. */
export function parseWorktrees(out: string): { path: string; branch: string; prunable: boolean }[] {
  return out
    .split(/\n\n+/)
    .filter((block) => block.trim() !== "")
    .map((block) => {
      let path = "";
      let branch = "";
      let prunable = false;
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
        else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
        else if (line === "prunable" || line.startsWith("prunable ")) prunable = true;
      }
      return { path, branch, prunable };
    });
}

const KIND_ORDER = { local: 0, remote: 1, tag: 2 } as const;

/** Each commit gets the refs pointing at it, local first, then remote, then tags. */
export function attachRefs(commits: Omit<GraphCommit, "refs">[], entries: RefEntry[]): GraphCommit[] {
  const byHash = new Map<string, GraphRef[]>();
  for (const { hash, ref } of entries) byHash.set(hash, [...(byHash.get(hash) ?? []), ref]);
  return commits.map((c) => ({
    ...c,
    refs: [...(byHash.get(c.hash) ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
  }));
}

/** `rev-list --left-right --count <base>...<tip>`: left is what the base has that the tip lacks. */
export function parseCounts(out: string): { behind: number; ahead: number } {
  const [behind = "0", ahead = "0"] = out.trim().split(/\s+/);
  return { behind: Number(behind), ahead: Number(ahead) };
}
