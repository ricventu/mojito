import type { SelectOption } from "./selectSummary";

/** One worktree as the server reports it (see listPickableWorktrees). */
export interface WorktreeChoice {
  path: string;
  branch: string;
}

/**
 * The select value standing for "no worktree": the repo root, which is where a launch
 * lands when nothing is picked. Empty rather than a sentinel because it is also what the
 * wire means by "no pick" — the server ignores an empty `worktree` (see pickOrRepo), so
 * the field's default needs no translation on the way out.
 */
export const REPO_ROOT = "";

/** What "no worktree" reads as in the sheets. */
export const REPO_ROOT_LABEL = "Repo root";

/** The last segment of a path, for a worktree with no branch name to show. */
function dirName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * The options for a sheet's Worktree field: the repo root first, then the repo's linked
 * worktrees in the order the server listed them (RIC-243).
 *
 * A worktree is named by its branch, which is what the human recognises — the ticket id
 * is in there. A detached one has no branch, so it falls back to its directory name:
 * these go into a searchable select, where an option with no label cannot be found or
 * even seen.
 *
 * The repo root carries its own branch when the server supplies one (RIC-333) — the one
 * thing the human needs to know before picking where to open.
 */
export function worktreeOptions(worktrees: readonly WorktreeChoice[], repoRootBranch = ""): SelectOption[] {
  const rootLabel = repoRootBranch ? `${REPO_ROOT_LABEL} · ${repoRootBranch}` : REPO_ROOT_LABEL;
  return [
    { value: REPO_ROOT, label: rootLabel },
    ...worktrees.map((w) => ({ value: w.path, label: w.branch || dirName(w.path) })),
  ];
}
