import { repoForTicket } from "./ticketCwd.js";
import { findExistingTicketWorktree, listLocalBranches } from "./worktree.js";
import { detectDefaultBranch } from "./merge.js";

export interface TicketWorktreeStatus {
  exists: boolean;
  // Populated only when exists is false — the choices the "create a worktree?" prompt offers.
  branches: string[];
  defaultBranch: string | null;
}

export interface TicketWorktreeStatusDeps {
  repoForTicket: typeof repoForTicket;
  findExistingTicketWorktree: typeof findExistingTicketWorktree;
  listLocalBranches: typeof listLocalBranches;
  detectDefaultBranch: typeof detectDefaultBranch;
}

/**
 * What the launch sheet needs to decide whether to ask "create a worktree for this
 * ticket?" before starting a session: whether one already exists (in which case there is
 * nothing to ask — the launch just opens it), and if not, the branches to offer as its
 * base. A ticket that maps to no repo also answers exists:true — there is nothing to
 * create either way, and the launch itself already reports "no-repo" when it's attempted.
 */
export async function getTicketWorktreeStatus(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
  title: string,
  deps: TicketWorktreeStatusDeps = { repoForTicket, findExistingTicketWorktree, listLocalBranches, detectDefaultBranch },
): Promise<TicketWorktreeStatus> {
  const repo = deps.repoForTicket(projectsPath, ticket, projectName);
  if (!repo) return { exists: true, branches: [], defaultBranch: null };
  if (deps.findExistingTicketWorktree(repo, ticket, title)) return { exists: true, branches: [], defaultBranch: null };
  const branches = deps.listLocalBranches(repo);
  let defaultBranch: string | null = null;
  try { defaultBranch = await deps.detectDefaultBranch(repo); } catch { /* no default found — leave null */ }
  return { exists: false, branches, defaultBranch };
}
