import { repoForTicket } from "./ticketCwd";
import { findExistingTicketWorktree, listLocalBranches, listPickableWorktrees } from "./worktree";
import { detectDefaultBranch } from "./merge";

export interface TicketWorktreeStatus {
  exists: boolean;
  // Populated only when exists is false — the choices the "create a worktree?" prompt offers.
  branches: string[];
  defaultBranch: string | null;
  // The repo's other worktrees, for the prompt's third answer: open in one that is already
  // there (RIC-243). Populated on the same condition as `branches`, because that prompt is
  // the only place the picker appears — a ticket that already has a worktree opens in it
  // with no question asked, so there is nothing to offer and no git call to spend.
  worktrees: { path: string; branch: string }[];
}

export interface TicketWorktreeStatusDeps {
  repoForTicket: typeof repoForTicket;
  findExistingTicketWorktree: typeof findExistingTicketWorktree;
  listLocalBranches: typeof listLocalBranches;
  detectDefaultBranch: typeof detectDefaultBranch;
  listPickableWorktrees: typeof listPickableWorktrees;
}

/**
 * What the launch sheet needs to decide whether to ask "create a worktree for this
 * ticket?" before starting a session: whether one already exists (in which case there is
 * nothing to ask — the launch just opens it), and if not, the branches to offer as its
 * base and the worktrees the repo already has to offer as an alternative to creating one. A ticket that maps to no repo also answers exists:true — there is nothing to
 * create either way, and the launch itself already reports "no-repo" when it's attempted.
 */
export async function getTicketWorktreeStatus(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
  title: string,
  deps: TicketWorktreeStatusDeps = { repoForTicket, findExistingTicketWorktree, listLocalBranches, detectDefaultBranch, listPickableWorktrees },
): Promise<TicketWorktreeStatus> {
  const repo = deps.repoForTicket(projectsPath, ticket, projectName);
  if (!repo) return { exists: true, branches: [], defaultBranch: null, worktrees: [] };
  if (deps.findExistingTicketWorktree(repo, ticket, title)) return { exists: true, branches: [], defaultBranch: null, worktrees: [] };
  const branches = deps.listLocalBranches(repo);
  const worktrees = deps.listPickableWorktrees(repo).map((w) => ({ path: w.path, branch: w.branch }));
  let defaultBranch: string | null = null;
  try { defaultBranch = await deps.detectDefaultBranch(repo); } catch { /* no default found — leave null */ }
  return { exists: false, branches, defaultBranch, worktrees };
}
