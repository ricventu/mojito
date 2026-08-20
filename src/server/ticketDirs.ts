import { loadProjectMap, resolvePathForProject } from "./projects";
import { repoRootFromWorktree } from "./merge";
import { resolveTicketWorktree } from "./ticketCwd";

export interface TicketDirs {
  worktree: string | null;
  repoRoot: string | null;
}

/**
 * Both sides of a ticket's git state: the worktree holding its branch, and the project's
 * main checkout that a local fast-forward lands in. The main checkout comes from the project
 * map when the project is mapped, and otherwise from git itself (repoRootFromWorktree) —
 * asking the worktree beats guessing, and resolveTicketCwd would just hand back the worktree.
 */
export async function resolveTicketDirs(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
): Promise<TicketDirs> {
  const worktree = resolveTicketWorktree(projectsPath, ticket, projectName);
  const mapped = projectName ? resolvePathForProject(loadProjectMap(projectsPath), projectName) : null;
  return { worktree, repoRoot: mapped ?? (worktree ? await repoRootFromWorktree(worktree) : null) };
}
