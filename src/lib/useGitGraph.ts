"use client";

// What a graph is of: a project's repo, a ticket (its worktree, else its repo), or a
// live session's cwd. The standalone view only ever holds the first two — a session's
// graph is an overlay inside its terminal (see appLocation).
export type GitTarget = { project: string } | { ticket: string; project: string | null } | { session: string };

export function gitTargetQuery(t: GitTarget): string {
  const p = new URLSearchParams();
  if ("session" in t) p.set("session", t.session);
  else if ("ticket" in t) {
    p.set("ticket", t.ticket);
    if (t.project) p.set("project", t.project);
  } else p.set("project", t.project);
  return p.toString();
}
