import { existsSync } from "node:fs";
import type { GitOp, GitSyncResult } from "@mojito/shared";
import { Hono } from "hono";
import { expandHome } from "../../homePath";
import { runGit } from "../../git/git";
import { SyncError, pull, push } from "../../git/sync";
import { launchGitResolve } from "../../sessions/launch";
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

  return new Hono().post("/projects/:name/:op{pull|push}", async (c) => {
    const name = c.req.param("name");
    const op = c.req.param("op") as GitOp;
    const project = deps.projects.get(name);
    if (!project) return c.json({ error: `project not found: ${name}` }, 404);
    const cwd = expandHome(project.path, deps.cfg.home);
    if (!exists(cwd)) return c.json({ error: `project path not found: ${cwd}` }, 400);
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
