import { repoForTicket } from "./ticketCwd";
import { fetchAllRemotes, gitFailureDetail } from "./worktree";
import { getTicketWorktreeStatus, type TicketWorktreeStatus } from "./ticketWorktreeStatus";

export interface FetchedTicketWorktreeStatus {
  status: TicketWorktreeStatus;
  // Set when the fetch itself failed. The status is still returned and still true — it is
  // what git has locally, which is exactly what a launch would branch off — so the sheet
  // shows the message beside a usable list rather than replacing it with an error.
  warning: string | null;
}

export interface FetchTicketRemotesDeps {
  repoForTicket: typeof repoForTicket;
  fetchAllRemotes: typeof fetchAllRemotes;
  getTicketWorktreeStatus: typeof getTicketWorktreeStatus;
}

/**
 * The launch sheet's Fetch action: refresh the repo's remote-tracking refs, then answer the
 * worktree status again so the base-branch list reflects what the server actually has.
 *
 * The status is re-read *after* the fetch and not reused from the sheet's own copy, because
 * a fetch is precisely what changes it — a branch created on the remote since the sheet
 * opened is the case this exists for.
 *
 * A ticket that maps to no repo fetches nothing and simply answers the ordinary status: the
 * sheet never shows the action there, and a request that arrives anyway is not an error.
 */
export async function fetchTicketRemotes(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
  title: string,
  deps: FetchTicketRemotesDeps = { repoForTicket, fetchAllRemotes, getTicketWorktreeStatus },
): Promise<FetchedTicketWorktreeStatus> {
  const repo = deps.repoForTicket(projectsPath, ticket, projectName);
  let warning: string | null = null;
  if (repo) {
    try {
      await deps.fetchAllRemotes(repo);
    } catch (e) {
      warning = `git fetch failed: ${gitFailureDetail(e)}`;
    }
  }
  return { status: await deps.getTicketWorktreeStatus(projectsPath, ticket, projectName, title), warning };
}
