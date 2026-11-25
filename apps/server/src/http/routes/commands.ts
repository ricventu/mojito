import { existsSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { AssistBody, CommandRunBody, commandsFor, effectiveCommands, isRunnableCommandId, type CommandResult } from "@mojito/shared";
import { Hono, type Context } from "hono";
import { AssistError, assistCommand } from "../../commands/assist";
import { expandHome } from "../../homePath";
import { launchCommand, type ProjectSessionResult } from "../../sessions/launch";
import { parseBody } from "../body";
import type { AppDeps } from "../app";

/**
 * Quick commands (RIC-581): the list in force, and a command run in a project: a Claude session
 * under `mj-<slug>-<command id>`, answered like the project's git session (`alreadyOpen`). The
 * bodyless run of a stored command stays for a client on an older build.
 */
export function commandRoutes(deps: AppDeps): Hono {
  const exists = deps.exists ?? existsSync;
  const assist = deps.assist ?? ((b: AssistBody) => assistCommand(b, { query }));
  return new Hono()
    .get("/commands", (c) => c.json({ commands: effectiveCommands(deps.settings.get().commands) }))
    .post("/commands/assist", async (c) => {
      const body = await parseBody(c, AssistBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      try {
        return c.json(await assist(body.data));
      } catch (err) {
        if (err instanceof AssistError) return c.json({ error: err.message }, 502);
        throw err;
      }
    })
    .post("/projects/:name/commands/:id", async (c) => {
      const name = c.req.param("name");
      const project = deps.projects.get(name);
      if (!project) return c.json({ error: `project not found: ${name}` }, 404);
      const cwd = expandHome(project.path, deps.cfg.home);
      if (!exists(cwd)) return c.json({ error: `project path not found: ${cwd}` }, 400);
      const id = c.req.param("id");
      const command = commandsFor(effectiveCommands(deps.settings.get().commands), name).find((x) => x.id === id);
      if (!command) return c.json({ error: `command not found: ${id}` }, 404);
      return answer(c, await launchCommand(name, command, deps.launch));
    })
    // The run sheet's (RIC-622): the command as the sender has it, with the sheet's picks. Nothing
    // is looked up by id — on a peer it is the sender's command — the id only names the session.
    .post("/projects/:name/commands/:id/run", async (c) => {
      const name = c.req.param("name");
      const project = deps.projects.get(name);
      if (!project) return c.json({ error: `project not found: ${name}` }, 404);
      const id = c.req.param("id");
      if (!isRunnableCommandId(id)) return c.json({ error: `invalid command id: ${id}` }, 400);
      const body = await parseBody(c, CommandRunBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      const cwd = expandHome(project.path, deps.cfg.home);
      if (!exists(cwd)) return c.json({ error: `project path not found: ${cwd}` }, 400);
      return answer(c, await launchCommand(name, { id, ...body.data }, deps.launch));
    });
}

function answer(c: Context, launched: ProjectSessionResult) {
  if (!launched.ok) return c.json({ error: launched.error, ...(launched.sessionId ? { sessionId: launched.sessionId } : {}) }, launched.status);
  return c.json({ session: launched.session, alreadyOpen: launched.alreadyOpen } satisfies CommandResult);
}
