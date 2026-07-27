import { parseIdentifier } from "./sessionKey.js";
import { loadProjectMap, resolveRepoFromMap } from "./limeProjects.js";
import { resolveWorktree } from "./worktree.js";

// Where a ticket lives on disk: its worktree if one exists, else the repo root.
// Shared by the launcher (a session's spawn cwd) and the docs routes (where to
// look for markdown). null = the ticket maps to no repo at all.
export function resolveTicketCwd(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
): string | null {
  try {
    const { teamKey } = parseIdentifier(ticket);
    const repo = resolveRepoFromMap(loadProjectMap(projectsPath), teamKey, projectName);
    if (!repo) return null;
    return resolveWorktree(repo, ticket) ?? repo;
  } catch {
    // Malformed ticket id, or an unreadable projects file: no directory to offer.
    return null;
  }
}
