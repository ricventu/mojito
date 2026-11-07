import type { GitRun } from "./git";

/**
 * How many linked worktrees `git worktree list --porcelain` lists: every entry but the first
 * (the main checkout), and not one marked `prunable` (its directory is gone, it is only a
 * record `git worktree prune` would drop). The badge on a project's Clean (RIC-528).
 */
export function parseWorktreeCount(porcelain: string): number {
  const entries = porcelain
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter(Boolean))
    .filter((lines) => lines[0]?.startsWith("worktree "));
  return entries.slice(1).filter((lines) => !lines.some((line) => line.startsWith("prunable"))).length;
}

/** The linked worktrees of the repository `cwd` is in. A `GitError` when git cannot list them. */
export async function countWorktrees(cwd: string, run: GitRun): Promise<number> {
  return parseWorktreeCount(await run(["worktree", "list", "--porcelain"], cwd));
}
