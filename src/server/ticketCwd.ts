import { parseIdentifier } from "./sessionKey.js";
import { loadProjectMap, resolveRepoFromMap } from "./limeProjects.js";
import { resolveWorktree } from "./worktree.js";

// The repo a ticket's project maps to, or null.
function repoForTicket(projectsPath: string, ticket: string, projectName: string | null): string | null {
  const { teamKey } = parseIdentifier(ticket);
  const repo = resolveRepoFromMap(loadProjectMap(projectsPath), teamKey, projectName);
  // entry.projects[projectName] can hand back the object's own prototype instead
  // of undefined — e.g. projectName === "__proto__" against a "projects" map with
  // no own property by that name — despite resolveRepoFromMap's string | null
  // signature. Guard the type (on top of the original falsy check) so a
  // non-string value never reaches resolveWorktree()/resolve() and throws a
  // 500 downstream.
  return !repo || typeof repo !== "string" ? null : repo;
}

// The ticket's worktree, and only that — null when the ticket maps to no repo or
// has no worktree yet. Distinct from resolveTicketCwd's repo-root fallback because
// a caller that already holds a directory needs to know whether a worktree exists
// before replacing what it has: a stage-1 session's cwd is the repo root (the
// worktree is created mid-session by /lime-design), so it should be upgraded to the
// worktree, while a stage-2 session's cwd already IS a worktree and must never be
// downgraded to the repo root just because a branch was renamed.
export function resolveTicketWorktree(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
): string | null {
  try {
    const repo = repoForTicket(projectsPath, ticket, projectName);
    return repo ? resolveWorktree(repo, ticket) : null;
  } catch {
    return null;
  }
}

// Where a ticket lives on disk: its worktree if one exists, else the repo root.
// Shared by the launcher (a session's spawn cwd) and the docs routes (where to
// look for markdown). null = the ticket maps to no repo at all.
export function resolveTicketCwd(
  projectsPath: string,
  ticket: string,
  projectName: string | null,
): string | null {
  try {
    const repo = repoForTicket(projectsPath, ticket, projectName);
    if (!repo) return null;
    return resolveWorktree(repo, ticket) ?? repo;
  } catch {
    // Malformed ticket id, or an unreadable projects file: no directory to offer.
    // Note this catch does NOT cover the __proto__ case above — resolveWorktree()
    // swallows its own execFileSync failure and returns null, so `?? repo` would
    // otherwise leak the bad non-string value out instead of throwing into here.
    return null;
  }
}
