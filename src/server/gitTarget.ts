import { execFileSync } from "node:child_process";
import type { SessionMeta } from "./types";
import { loadProjectMap, resolvePathForProject } from "./projects";
import { repoForTicket, resolveTicketWorktree } from "./ticketCwd";
import { getConfig, getRegistry } from "./app";

export interface GitTargetDeps {
  session: (id: string) => SessionMeta | undefined;
  projectsPath: string;
  // The branch checked out in a directory, or null (detached, or not a repo).
  currentBranch: (cwd: string) => string | null;
}

export type GitTargetResult =
  | { ok: true; cwd: string; label: string; highlight: string | null }
  | { ok: false; error: string; code: 400 | 404 };

// The git graph's three entry points, resolved the way resolveDocsTarget resolves the
// docs' two — a session wins when several are present, as there. "Not a repo" is not
// decided here: the graph read is what finds out, and answers 409 with git's own words.
export function resolveGitTarget(url: URL, deps: GitTargetDeps): GitTargetResult {
  const q = url.searchParams;
  const session = q.get("session");
  if (session) {
    const meta = deps.session(session);
    if (!meta) return { ok: false, error: "unknown session", code: 404 };
    // As docs: a session's cwd is frozen at launch, and a ticket's worktree may have
    // appeared since — prefer it, and never downgrade a cwd already inside one.
    const worktree = meta.ticket
      ? resolveTicketWorktree(deps.projectsPath, meta.ticket, meta.projectName ?? null)
      : null;
    const cwd = worktree ?? meta.cwd;
    if (!cwd) return { ok: false, error: "session has no working directory", code: 400 };
    return { ok: true, cwd, label: meta.ticket || meta.title, highlight: deps.currentBranch(cwd) };
  }
  const ticket = q.get("ticket");
  if (ticket) {
    const project = q.get("project") || null;
    const worktree = resolveTicketWorktree(deps.projectsPath, ticket, project);
    if (worktree) return { ok: true, cwd: worktree, label: ticket, highlight: deps.currentBranch(worktree) };
    let repo: string | null = null;
    try { repo = repoForTicket(deps.projectsPath, ticket, project); } catch { /* malformed id */ }
    if (!repo) return { ok: false, error: "unknown ticket", code: 404 };
    return { ok: true, cwd: repo, label: ticket, highlight: null };
  }
  const project = q.get("project");
  if (project) {
    const path = resolvePathForProject(loadProjectMap(deps.projectsPath), project);
    if (!path) return { ok: false, error: "unknown project", code: 404 };
    return { ok: true, cwd: path, label: project, highlight: null };
  }
  return { ok: false, error: "project, session or ticket required", code: 400 };
}

export function currentBranch(cwd: string): string | null {
  try {
    const name = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return name && name !== "HEAD" ? name : null;
  } catch {
    return null;
  }
}

export function gitTargetDeps(): GitTargetDeps {
  return { session: (id) => getRegistry().get(id), projectsPath: getConfig().projectsPath, currentBranch };
}
