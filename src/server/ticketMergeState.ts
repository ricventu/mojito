import { isAlreadyMerged, isOnDefaultBranch } from "./merge";
import { resolveTicketDirs } from "./ticketDirs";

export interface MergeStateDeps {
  resolveTicketDirs: typeof resolveTicketDirs;
  isOnDefaultBranch: (input: { checkout: string; repoRoot: string }) => Promise<boolean>;
  isAlreadyMerged: (input: { worktree: string; repoRoot: string }) => Promise<boolean>;
}

/**
 * Whether a QA approve would have nothing to do. Two ways that happens: the work never took a
 * branch of its own (the checkout that holds it is sitting on the default branch — the work
 * prompt no longer asks for a worktree, and a one-line fix does not need one), or its branch
 * is already in the default branch because someone merged it outside Mojito.
 *
 * The answer is never given without asking git about a branch. A `true` here hides the
 * approves and offers only mark-done, which writes Done and runs no git — so a wrong `true`
 * strands real commits on an unmerged branch. In particular the ticket's "worktree" may BE the
 * main checkout (matchWorktree matches any worktree whose branch carries the ticket id,
 * including the main one), and that checkout can perfectly well be parked on a ticket branch
 * with unmerged commits.
 *
 * Anything we cannot determine — an unresolvable main checkout, a failing git — answers false,
 * so the gate falls back to the ordinary approve path and fails loudly there if it must. Same
 * policy as `isAlreadyMerged`: a broken check degrades to the safe path, never the destructive
 * one.
 *
 * The gate and the mark-done guard both call this, so what the UI offers and what the server
 * accepts can never disagree.
 */
export async function hasNothingToMerge(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
  deps: MergeStateDeps = { resolveTicketDirs, isOnDefaultBranch, isAlreadyMerged },
): Promise<boolean> {
  const { worktree, repoRoot } = await deps.resolveTicketDirs(projectsPath, ticket, projectName);
  // Cannot tell: without a main checkout there is no default branch to compare against.
  if (!repoRoot) return false;
  // The checkout that holds the work: the ticket's worktree when it has one, else the repo root.
  const checkout = worktree ?? repoRoot;
  if (await deps.isOnDefaultBranch({ checkout, repoRoot })) return true;
  return deps.isAlreadyMerged({ worktree: checkout, repoRoot });
}
