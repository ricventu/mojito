import { loadProjectMap, resolvePathForProject } from "./projects";
import { listPickableWorktrees } from "./worktree";
import { currentBranch } from "./projectStack";

export interface ProjectWorktrees {
  worktrees: { path: string; branch: string }[];
  /** The current branch of the repo root (RIC-333). "" when git cannot answer. */
  repoRootBranch: string;
}

export interface ProjectWorktreesDeps {
  loadProjectMap: typeof loadProjectMap;
  resolvePathForProject: typeof resolvePathForProject;
  listPickableWorktrees: typeof listPickableWorktrees;
  currentBranch: typeof currentBranch;
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
export async function getProjectWorktrees(
  projectsPath: string,
  projectName: string | null,
  deps: ProjectWorktreesDeps = { loadProjectMap, resolvePathForProject, listPickableWorktrees, currentBranch },
): Promise<ProjectWorktrees> {
  if (!projectName) return { worktrees: [], repoRootBranch: "" };
  const repo = deps.resolvePathForProject(deps.loadProjectMap(projectsPath), projectName);
  if (!repo) return { worktrees: [], repoRootBranch: "" };
  let repoRootBranch = "";
  try {
    repoRootBranch = await deps.currentBranch(repo);
  } catch {
    // Detached HEAD or git failed — leave empty.
  }
  return {
    worktrees: deps.listPickableWorktrees(repo).map((w) => ({ path: w.path, branch: w.branch })),
    repoRootBranch,
  };
}
