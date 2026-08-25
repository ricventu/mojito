import { repoForTicket } from "./ticketCwd";
import { findExistingTicketWorktree, listLocalBranches, listRemoteBranches, listPickableWorktrees } from "./worktree";
import { detectDefaultBranch } from "./merge";

export interface TicketWorktreeStatus {
  exists: boolean;
  // Populated only when exists is false — the choices the "create a worktree?" prompt offers.
  // Local branches and remote-tracking ones are reported apart, not merged: the sheet lists
  // the remotes first and pre-selects among them, so it has to be able to tell them apart.
  branches: string[];
  remoteBranches: string[];
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
  listRemoteBranches: typeof listRemoteBranches;
  detectDefaultBranch: typeof detectDefaultBranch;
  listPickableWorktrees: typeof listPickableWorktrees;
}

// The answer when there is no question to ask: the ticket's worktree is there, or there is
// no repo to create one in. Every list stays empty — the sheet only reads them when it asks.
// A function rather than a constant so no caller shares (or mutates) one set of arrays.
const nothingToAsk = (): TicketWorktreeStatus =>
  ({ exists: true, branches: [], remoteBranches: [], defaultBranch: null, worktrees: [] });

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
  deps: TicketWorktreeStatusDeps = {
    repoForTicket, findExistingTicketWorktree, listLocalBranches, listRemoteBranches,
    detectDefaultBranch, listPickableWorktrees,
  },
): Promise<TicketWorktreeStatus> {
  const repo = deps.repoForTicket(projectsPath, ticket, projectName);
  if (!repo) return nothingToAsk();
  if (deps.findExistingTicketWorktree(repo, ticket, title)) return nothingToAsk();
  const branches = deps.listLocalBranches(repo);
  const remoteBranches = deps.listRemoteBranches(repo);
  const worktrees = deps.listPickableWorktrees(repo).map((w) => ({ path: w.path, branch: w.branch }));
  let defaultBranch: string | null = null;
  try { defaultBranch = await deps.detectDefaultBranch(repo); } catch { /* no default found — leave null */ }
  return { exists: false, branches, remoteBranches, defaultBranch, worktrees };
}
