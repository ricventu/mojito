import type { SessionMeta } from "./types.js";
import { resolveTicketCwd, resolveTicketWorktree } from "./ticketCwd.js";
import { getConfig, getRegistry } from "./app.js";

export interface DocsTargetDeps {
  // Look up a live session by its tmux name — the registry, in production.
  session: (id: string) => SessionMeta | undefined;
  // Path to the projects map, for a ticket with no live session.
  projectsPath: string;
}

export type DocsTargetResult =
  | { ok: true; root: string; label: string }
  | { ok: false; error: string; code: 400 | 404 | 409 };

// Both docs routes accept the same two target shapes: a live session or a ticket
// (resolved the way a launch would). One place decides, so the two routes cannot
// drift on status codes. A session wins when both are present — it is the more
// specific answer.
export function resolveDocsTarget(url: URL, deps: DocsTargetDeps): DocsTargetResult {
  const session = url.searchParams.get("session");
  if (session) {
    const meta = deps.session(session);
    if (!meta) return { ok: false, error: "unknown session", code: 404 };
    // A session's cwd is frozen at launch, and a stage-1 session is launched before
    // its worktree exists — the work session creates it mid-session — so cwd stays
    // the repo root while the spec the session writes lands in the worktree. Re-resolve
    // the worktree per request and prefer it; falling back to cwd (rather than to
    // the repo root) keeps a session that is already inside a worktree where it is.
    const worktree = meta.ticket
      ? resolveTicketWorktree(deps.projectsPath, meta.ticket, meta.projectName ?? null)
      : null;
    const root = worktree ?? meta.cwd;
    if (!root) return { ok: false, error: "session has no working directory", code: 400 };
    return { ok: true, root, label: meta.ticket || meta.title };
  }
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const root = resolveTicketCwd(deps.projectsPath, ticket, url.searchParams.get("project"));
    if (!root) return { ok: false, error: "no worktree for this ticket", code: 409 };
    return { ok: true, root, label: ticket };
  }
  return { ok: false, error: "session or ticket required", code: 400 };
}

// The production wiring for resolveDocsTarget. Kept out of the resolver itself so
// tests can pass their own lookup and project map without touching the registry
// singleton or the real state directory.
export function docsDeps(): DocsTargetDeps {
  return { session: (id) => getRegistry().get(id), projectsPath: getConfig().projectsPath };
}
