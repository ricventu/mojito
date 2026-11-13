import { existsSync } from "node:fs";
import { commandsFor, effectiveCommands, type CommandResult } from "@mojito/shared";
import { Hono } from "hono";
import { expandHome } from "../../homePath";
import { launchCommand } from "../../sessions/launch";
import type { AppDeps } from "../app";

/**
 * Quick commands (RIC-581): the list in force, and a command run in a project: a Claude session
 * under `mj-<slug>-<command id>`, answered like the project's git session (`alreadyOpen`).
 */
export function commandRoutes(deps: AppDeps): Hono {
  const exists = deps.exists ?? existsSync;
  return new Hono()
    .get("/commands", (c) => c.json({ commands: effectiveCommands(deps.settings.get().commands) }))
    .post("/projects/:name/commands/:id", async (c) => {
      const name = c.req.param("name");
      const project = deps.projects.get(name);
      if (!project) return c.json({ error: `project not found: ${name}` }, 404);
      const cwd = expandHome(project.path, deps.cfg.home);
      if (!exists(cwd)) return c.json({ error: `project path not found: ${cwd}` }, 400);
      const id = c.req.param("id");
      const command = commandsFor(effectiveCommands(deps.settings.get().commands), name).find((x) => x.id === id);
      if (!command) return c.json({ error: `command not found: ${id}` }, 404);
      const launched = await launchCommand(name, command, deps.launch);
      if (!launched.ok) return c.json({ error: launched.error, ...(launched.sessionId ? { sessionId: launched.sessionId } : {}) }, launched.status);
      return c.json({ session: launched.session, alreadyOpen: launched.alreadyOpen } satisfies CommandResult);
    });
}
