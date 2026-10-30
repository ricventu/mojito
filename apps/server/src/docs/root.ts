import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitRun } from "../git/git";
import { defaultBase } from "../git/defaultBranch";
import { markWorktrees, parseRefs, parseWorktrees, REF_FORMAT } from "../git/graph";
import { findTicketBranch } from "../git/ticketBranch";

type Ref = { name: string; hash: string };

/** Where a project's documents are read: `branch`/`base` are the ticket's branch and its base, when found. */
export interface DocRoot {
  root: string;
  branch: Ref | null;
  base: Ref | null;
}

/** A failing read here means "not there": no `origin/HEAD`. */
const orNull = async (run: GitRun, args: string[], cwd: string): Promise<string | null> => {
  try {
    return (await run(args, cwd)).trim() || null;
  } catch {
    return null;
  }
};

/** The checkout's path inside its repo (`web` for a project in `repo/web`), "" at the top. */
const projectPrefix = async (checkout: string, run: GitRun) =>
  (await run(["rev-parse", "--show-prefix"], checkout)).trim().replace(/\/$/, "");

/**
 * The checkout, unless the ticket's branch is checked out in another (live) worktree: then that
 * worktree, at the project's own prefix — where the ticket's session writes. Looking is
 * best-effort: any failure leaves the checkout.
 */
export async function docRoot(checkout: string, ticket: string | null, run: GitRun): Promise<DocRoot> {
  const plain: DocRoot = { root: checkout, branch: null, base: null };
  if (!ticket) return plain;
  try {
    const [refsOut, worktreesOut, top, prefix, originHead] = await Promise.all([
      run(["for-each-ref", `--format=${REF_FORMAT}`, "refs/heads", "refs/remotes/origin"], checkout),
      run(["worktree", "list", "--porcelain"], checkout),
      run(["rev-parse", "--show-toplevel"], checkout),
      projectPrefix(checkout, run),
      orNull(run, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], checkout),
    ]);
    const worktrees = parseWorktrees(worktreesOut);
    const entries = markWorktrees(parseRefs(refsOut), worktrees);
    const branch = findTicketBranch(entries, ticket);
    if (!branch) return plain;
    const base = defaultBase(entries, originHead, branch.name);
    const tree = worktrees.find((w) => !w.prunable && w.branch === branch.name);
    const elsewhere = tree && tree.path !== top.trim() && existsSync(tree.path);
    return { root: elsewhere ? join(tree.path, prefix) : checkout, branch, base };
  } catch {
    return plain;
  }
}

/**
 * Where an absolute document path may point: the root, the checkout, and every live worktree of
 * the repo at the project's prefix. A failing worktree list leaves the first two.
 */
export async function allowedRoots(checkout: string, root: string, run: GitRun): Promise<string[]> {
  const roots = [root, checkout];
  try {
    const [worktreesOut, prefix] = await Promise.all([
      run(["worktree", "list", "--porcelain"], checkout),
      projectPrefix(checkout, run),
    ]);
    for (const w of parseWorktrees(worktreesOut)) if (w.path && !w.prunable) roots.push(join(w.path, prefix));
  } catch {
    // Absolute paths then only reach the root and the checkout.
  }
  return roots;
}
