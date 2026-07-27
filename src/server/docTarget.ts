import type { SessionMeta } from "./types.js";
import { resolveTicketCwd } from "./ticketCwd.js";

export interface DocsTargetDeps {
  // Look up a live session by its tmux name — the registry, in production.
  session: (id: string) => SessionMeta | undefined;
  // Path to lime-projects.json, for a ticket with no live session.
  projectsPath: string;
}

export type DocsTargetResult =
  | { ok: true; root: string; label: string }
  | { ok: false; error: string; code: 400 | 404 | 409 };

// Both docs routes accept the same two target shapes: a live session (its cwd is
// already the worktree) or a ticket (resolved the way a launch would). One place
// decides, so the two routes cannot drift on status codes. A session wins when
// both are present — it is the more specific answer.
export function resolveDocsTarget(url: URL, deps: DocsTargetDeps): DocsTargetResult {
  const session = url.searchParams.get("session");
  if (session) {
    const meta = deps.session(session);
    if (!meta) return { ok: false, error: "unknown session", code: 404 };
    if (!meta.cwd) return { ok: false, error: "session has no working directory", code: 400 };
    return { ok: true, root: meta.cwd, label: meta.ticket || meta.title };
  }
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const root = resolveTicketCwd(deps.projectsPath, ticket, url.searchParams.get("project"));
    if (!root) return { ok: false, error: "no worktree for this ticket", code: 409 };
    return { ok: true, root, label: ticket };
  }
  return { ok: false, error: "session or ticket required", code: 400 };
}
