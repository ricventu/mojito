import { existsSync } from "node:fs";
import type { CleanResult, GitOp, GitSyncResult, WorktreeCount } from "@mojito/shared";
import { Hono } from "hono";
import { expandHome } from "../../homePath";
import { GitError, readGit, runGit } from "../../git/git";
import { SyncError, pull, push } from "../../git/sync";
import { countWorktrees } from "../../git/worktrees";
import { launchClean, launchGitResolve } from "../../sessions/launch";
import type { AppDeps } from "../app";

/** The two operations, bound to a checkout. Injectable so the route is tested without git. */
export interface GitSync {
  pull: (cwd: string) => ReturnType<typeof pull>;
  push: (cwd: string) => ReturnType<typeof push>;
}

export const defaultGitSync: GitSync = { pull: (cwd) => pull(cwd, runGit), push: (cwd) => push(cwd, runGit) };

/**
 * Pull and Push of a project's checkout. One operation per project at a time: two at once would
 * fetch, rebase and push over each other. A conflict hands the repo to the project's git session
 * (`launchGitResolve`), and the answer names it so the client can open its terminal.
 */
export function gitRoutes(deps: AppDeps): Hono {
  const git = deps.git ?? defaultGitSync;
  const exists = deps.exists ?? existsSync;
  const running = new Map<string, GitOp>();

  const worktrees = deps.worktrees ?? ((cwd: string) => countWorktrees(cwd, readGit));

  /** The mapped project's expanded checkout, or the answer that refuses it. */
  const checkout = (name: string): { cwd: string } | { error: string; status: 400 | 404 } => {
    const project = deps.projects.get(name);
    if (!project) return { error: `project not found: ${name}`, status: 404 };
    const cwd = expandHome(project.path, deps.cfg.home);
    if (!exists(cwd)) return { error: `project path not found: ${cwd}`, status: 400 };
    return { cwd };
  };

  return new Hono()
    .get("/projects/:name/worktrees", async (c) => {
      const found = checkout(c.req.param("name"));
      if ("error" in found) return c.json({ error: found.error }, found.status);
      try {
        return c.json({ count: await worktrees(found.cwd) } satisfies WorktreeCount);
      } catch (err) {
        if (err instanceof GitError) return c.json({ error: err.message.slice(0, 500) }, 409);
        throw err;
      }
    })
    // Clean (RIC-528): the project's clean session, which lists and asks before it deletes.
    .post("/projects/:name/clean", async (c) => {
      const name = c.req.param("name");
      const found = checkout(name);
      if ("error" in found) return c.json({ error: found.error }, found.status);
      const launched = await launchClean(name, deps.launch);
      if (!launched.ok) return c.json({ error: launched.error }, launched.status);
      return c.json({ session: launched.session, alreadyOpen: launched.alreadyOpen } satisfies CleanResult);
    })
    .post("/projects/:name/:op{pull|push}", async (c) => {
    const name = c.req.param("name");
    const op = c.req.param("op") as GitOp;
    const found = checkout(name);
    if ("error" in found) return c.json({ error: found.error }, found.status);
    const { cwd } = found;
    const busy = running.get(name);
    if (busy) return c.json({ error: `a ${busy} is already running on ${name}` }, 409);

    running.set(name, op);
    try {
      let outcome;
      try {
        outcome = await git[op](cwd);
      } catch (err) {
        if (err instanceof SyncError) return c.json({ error: err.message }, 422);
        throw err;
      }
      if (outcome.status !== "conflict") return c.json(outcome satisfies GitSyncResult);
      const launched = await launchGitResolve({ project: name, op, conflict: outcome }, deps.launch);
      if (!launched.ok) return c.json({ error: launched.error }, launched.status);
      const result: GitSyncResult = { status: "conflict", session: launched.session, alreadyOpen: launched.alreadyOpen };
      return c.json(result);
    } finally {
      running.delete(name);
    }
  });
}
