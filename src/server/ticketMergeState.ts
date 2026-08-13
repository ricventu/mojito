import { isAlreadyMerged } from "./merge.js";
import { resolveTicketDirs } from "./ticketDirs.js";

export interface MergeStateDeps {
  resolveTicketDirs: typeof resolveTicketDirs;
  isAlreadyMerged: (input: { worktree: string; repoRoot: string }) => Promise<boolean>;
}

/**
 * Whether a QA approve would have nothing to do. Two ways that happens: the ticket has no
 * branch of its own (the session worked straight in the checkout — the work prompt no longer
 * asks for a worktree, and a one-line fix does not need one), or its branch is already in the
 * default branch because someone merged it outside Mojito.
 *
 * The gate and the mark-done guard both call this, so what the UI offers and what the server
 * accepts can never disagree.
 */
export async function hasNothingToMerge(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
  deps: MergeStateDeps = { resolveTicketDirs, isAlreadyMerged },
): Promise<boolean> {
  const { worktree, repoRoot } = await deps.resolveTicketDirs(projectsPath, ticket, projectName);
  // No branch to compare: no worktree, no resolvable main checkout, or the "worktree" IS the
  // main checkout. None of these is a merge question, so none pays for a git call.
  if (!worktree || !repoRoot || worktree === repoRoot) return true;
  return deps.isAlreadyMerged({ worktree, repoRoot });
}
