import { loadProjectMap, resolvePathForProject } from "./projects";
import { listPickableWorktrees } from "./worktree";

export interface ProjectWorktrees {
  worktrees: { path: string; branch: string }[];
}

export interface ProjectWorktreesDeps {
  loadProjectMap: typeof loadProjectMap;
  resolvePathForProject: typeof resolvePathForProject;
  listPickableWorktrees: typeof listPickableWorktrees;
}

/**
 * The worktrees the New session sheet can offer for a project (RIC-243) — the
 * project-scoped counterpart of getTicketWorktreeStatus's `worktrees`, for a session or
 * terminal with no ticket to resolve a repo from.
 *
 * An empty list is the honest answer to every "nothing to pick here" case: General (the
 * home directory is not a repo), a project the map has dropped, a repo with no linked
 * worktree, and a repo git cannot read — the sheet hides the field on all of them alike.
 */
export function getProjectWorktrees(
  projectsPath: string,
  projectName: string | null,
  deps: ProjectWorktreesDeps = { loadProjectMap, resolvePathForProject, listPickableWorktrees },
): ProjectWorktrees {
  if (!projectName) return { worktrees: [] };
  const repo = deps.resolvePathForProject(deps.loadProjectMap(projectsPath), projectName);
  if (!repo) return { worktrees: [] };
  return { worktrees: deps.listPickableWorktrees(repo).map((w) => ({ path: w.path, branch: w.branch })) };
}
