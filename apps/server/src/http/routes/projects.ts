import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ProjectBody } from "@mojito/shared";
import { Hono } from "hono";
import { expandHome } from "../../homePath";
import type { AppDeps } from "../app";
import { parseBody } from "../body";

/**
 * The projects map. A path must be absolute (`~` counts, expanded to the server's home) and
 * exist on disk: a session is spawned there, and a relative path resolves against whatever cwd
 * tmux happens to have. The path is stored as typed. Every change refreshes the board, whose
 * Linear query is scoped to the project names.
 */
export function projectRoutes(deps: AppDeps): Hono {
  const exists = deps.exists ?? existsSync;
  const pathError = (typed: string): string | null => {
    const path = expandHome(typed, deps.cfg.home);
    if (!isAbsolute(path)) return `project path must be absolute: ${path}`;
    if (!exists(path)) return `project path not found: ${path}`;
    return null;
  };
  const changed = () => void deps.tickets.refresh();

  return new Hono()
    .get("/projects", (c) => c.json(deps.projects.list()))
    .post("/projects", async (c) => {
      const body = await parseBody(c, ProjectBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      const p = body.data;
      const invalid = pathError(p.path);
      if (invalid) return c.json({ error: invalid }, 400);
      if (deps.projects.get(p.name)) return c.json({ error: `project already exists: ${p.name}` }, 409);
      deps.projects.upsert(p);
      changed();
      return c.json(p, 201);
    })
    .put("/projects/:name", async (c) => {
      const name = c.req.param("name");
      if (!deps.projects.get(name)) return c.json({ error: `project not found: ${name}` }, 404);
      const body = await parseBody(c, ProjectBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      const p = body.data;
      const invalid = pathError(p.path);
      if (invalid) return c.json({ error: invalid }, 400);
      if (p.name !== name) {
        if (deps.projects.get(p.name)) return c.json({ error: `project already exists: ${p.name}` }, 409);
        deps.projects.rename(name, p);
      } else {
        deps.projects.upsert(p);
      }
      changed();
      return c.json(p);
    })
    .delete("/projects/:name", (c) => {
      const name = c.req.param("name");
      if (!deps.projects.get(name)) return c.json({ error: `project not found: ${name}` }, 404);
      deps.projects.remove(name);
      changed();
      return c.json({ ok: true });
    });
}
