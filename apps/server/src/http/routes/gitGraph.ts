import { existsSync } from "node:fs";
import { isValidHash, isValidTicket, type CommitDetails, type CommitDiff, type GitGraphPage } from "@mojito/shared";
import { Hono, type Context } from "hono";
import { readCommit, readDiff } from "../../git/commit";
import { GitError, readGit } from "../../git/git";
import { readGraph } from "../../git/graph";
import { expandHome } from "../../homePath";
import type { AppDeps } from "../app";

/** The three reads, bound to a checkout. Injectable so the routes are tested without git. */
export interface GitReader {
  graph(cwd: string, opts: { skip: number; ticket: string | null }): Promise<GitGraphPage>;
  commit(cwd: string, hash: string): Promise<CommitDetails | null>;
  diff(cwd: string, hash: string, path: string, from: string | null): Promise<CommitDiff | null>;
}

export const defaultGitReader: GitReader = {
  graph: (cwd, opts) => readGraph(cwd, opts, readGit),
  commit: (cwd, hash) => readCommit(cwd, hash, readGit),
  diff: (cwd, hash, path, from) => readDiff(cwd, hash, path, from, readGit),
};

/**
 * The read-only git graph of a project: one page of the graph, a commit's details and one file's
 * diff. Validation (project, path on disk, query and hash shape) comes before any git call; a git
 * failure — not a repo, a timeout — is the checkout's state, so a 409 with git's own words.
 */
export function gitGraphRoutes(deps: AppDeps): Hono {
  const reader = deps.gitRead ?? defaultGitReader;
  const exists = deps.exists ?? existsSync;

  /** The project's checkout, or the error answer. */
  const checkout = (c: Context): { cwd: string } | Response => {
    const name = c.req.param("name") ?? "";
    const project = deps.projects.get(name);
    if (!project) return c.json({ error: `project not found: ${name}` }, 404);
    const cwd = expandHome(project.path, deps.cfg.home);
    if (!exists(cwd)) return c.json({ error: `project path not found: ${cwd}` }, 400);
    return { cwd };
  };

  /** Runs a read; a `GitError` is a 409, anything else falls to `onError`. */
  const guarded = async <T>(c: Context, read: () => Promise<T>): Promise<Response | T> => {
    try {
      return await read();
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.output.trim().slice(0, 500) || err.message }, 409);
      throw err;
    }
  };

  return new Hono()
    .get("/projects/:name/git/graph", async (c) => {
      const where = checkout(c);
      if (where instanceof Response) return where;
      const rawSkip = c.req.query("skip");
      if (rawSkip !== undefined && !/^\d+$/.test(rawSkip)) return c.json({ error: "skip must be a non-negative integer" }, 400);
      const ticket = c.req.query("ticket") ?? null;
      if (ticket !== null && !isValidTicket(ticket)) return c.json({ error: "invalid ticket" }, 400);
      const skip = rawSkip === undefined ? 0 : Number(rawSkip);
      const page = await guarded(c, () => reader.graph(where.cwd, { skip, ticket }));
      return page instanceof Response ? page : c.json(page);
    })
    .get("/projects/:name/git/commits/:hash", async (c) => {
      const where = checkout(c);
      if (where instanceof Response) return where;
      const hash = c.req.param("hash");
      if (!isValidHash(hash)) return c.json({ error: "invalid commit hash" }, 400);
      const commit = await guarded(c, () => reader.commit(where.cwd, hash));
      if (commit instanceof Response) return commit;
      return commit ? c.json(commit) : c.json({ error: "commit not found" }, 404);
    })
    .get("/projects/:name/git/commits/:hash/diff", async (c) => {
      const where = checkout(c);
      if (where instanceof Response) return where;
      const hash = c.req.param("hash");
      if (!isValidHash(hash)) return c.json({ error: "invalid commit hash" }, 400);
      const path = c.req.query("path");
      if (!path) return c.json({ error: "path is required" }, 400);
      const from = c.req.query("from") || null;
      // A NUL cannot be in a path, and node refuses it in an argument (a TypeError, not a git failure).
      if (path.includes("\0") || from?.includes("\0")) return c.json({ error: "path contains a NUL byte" }, 400);
      const diff = await guarded(c, () => reader.diff(where.cwd, hash, path, from));
      if (diff instanceof Response) return diff;
      return diff ? c.json(diff) : c.json({ error: "commit not found" }, 404);
    });
}
