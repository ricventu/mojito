import { existsSync } from "node:fs";
import { isValidTicket, type DocList } from "@mojito/shared";
import { Hono, type Context } from "hono";
import { readDocFile, type DocFileResult } from "../../docs/file";
import { readDocList } from "../../docs/list";
import { GitError, readGit } from "../../git/git";
import { expandHome } from "../../homePath";
import type { AppDeps } from "../app";

/** The two reads, bound to a checkout. Injectable so the routes are tested without git. */
export interface DocsReader {
  list(cwd: string, ticket: string | null): Promise<DocList>;
  file(cwd: string, path: string, ticket: string | null): Promise<DocFileResult>;
}

/** Real git and disk; `home` expands a `~/` document path. */
export const docsReader = (home: string): DocsReader => ({
  list: (cwd, ticket) => readDocList(cwd, ticket, readGit),
  file: (cwd, path, ticket) => readDocFile(cwd, path, ticket, home, readGit),
});

const FILE_ERRORS = {
  invalid: [400, "not a markdown file in this project"],
  "not-found": [404, "document not found"],
  "too-large": [413, "document too large"],
} as const;

/**
 * A project's markdown, read-only: the list (with a ticket's own on top) and one document.
 * Validation (project, path on disk, ticket shape) comes before any read; a git failure of the
 * listing — not a repo, a timeout — is the checkout's state, so a 409 with git's own words.
 */
export function docsRoutes(deps: AppDeps): Hono {
  const reader = deps.docsRead ?? docsReader(deps.cfg.home);
  const exists = deps.exists ?? existsSync;

  /** The project's checkout and the ticket, or the error answer. */
  const target = (c: Context): { cwd: string; ticket: string | null } | Response => {
    const name = c.req.param("name") ?? "";
    const project = deps.projects.get(name);
    if (!project) return c.json({ error: `project not found: ${name}` }, 404);
    const cwd = expandHome(project.path, deps.cfg.home);
    if (!exists(cwd)) return c.json({ error: `project path not found: ${cwd}` }, 400);
    const ticket = c.req.query("ticket") ?? null;
    if (ticket !== null && !isValidTicket(ticket)) return c.json({ error: "invalid ticket" }, 400);
    return { cwd, ticket };
  };

  return new Hono()
    .get("/projects/:name/docs", async (c) => {
      const where = target(c);
      if (where instanceof Response) return where;
      try {
        return c.json(await reader.list(where.cwd, where.ticket));
      } catch (err) {
        if (err instanceof GitError) return c.json({ error: err.output.trim().slice(0, 500) || err.message }, 409);
        throw err;
      }
    })
    .get("/projects/:name/docs/file", async (c) => {
      const where = target(c);
      if (where instanceof Response) return where;
      const path = c.req.query("path");
      if (!path) return c.json({ error: "path is required" }, 400);
      const read = await reader.file(where.cwd, path, where.ticket);
      if (read.ok) return c.json(read.file);
      const [status, error] = FILE_ERRORS[read.reason];
      return c.json({ error }, status);
    });
}
