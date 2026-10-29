import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { LaunchBody } from "@mojito/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { parseBody } from "../body";
import { killSession } from "../../sessions/close";
import { launchFree, launchTicket } from "../../sessions/launch";

const NOT_CLOSED = "claude did not exit: open the terminal";

export function sessionRoutes(deps: AppDeps): Hono {
  const removeFile = deps.removeFile ?? ((path: string) => rmSync(path, { force: true }));

  // Forgetting an ended session: its row, and the hook settings it was launched with (which
  // carry the token). Only an ended one — a live session's row is how the board reaches it.
  const remove = (id: string): { status: 200 } | { status: 404 | 409; error: string } => {
    const row = deps.sessions.get(id);
    if (!row) return { status: 404, error: `session not found: ${id}` };
    if (row.state !== "ended") return { status: 409, error: `session not ended: ${id}` };
    deps.sessions.remove(id);
    deps.bus.emit({ type: "session.removed", id });
    // A row id is a tmux name and never a path, but it is about to become one.
    if (basename(id) === id) {
      try {
        removeFile(join(deps.cfg.stateDir, "hooks", `${id}.json`));
      } catch (err) {
        console.error(`could not delete hook settings of ${id}:`, err);
      }
    }
    return { status: 200 };
  };

  return new Hono()
    .get("/sessions", (c) => c.json(deps.sessions.list()))
    .post("/sessions", async (c) => {
      const body = await parseBody(c, LaunchBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      const result =
        body.data.kind === "ticket" ? await launchTicket(body.data, deps.launch) : await launchFree(body.data, deps.launch);
      if (!result.ok) {
        const { status, error, sessionId } = result;
        return c.json(sessionId === undefined ? { error } : { error, sessionId }, status);
      }
      const { session, warning } = result;
      return c.json(warning === undefined ? { session } : { session, warning }, 201);
    })
    .delete("/sessions/:id", async (c) => {
      const id = c.req.param("id");
      if (c.req.query("remove") === "1") {
        const r = remove(id);
        return r.status === 200 ? c.json({ ok: true }) : c.json({ error: r.error }, r.status);
      }
      const { status } = await killSession(id, {
        sessions: deps.sessions,
        bus: deps.bus,
        closeSession: deps.closeSession,
        now: deps.now,
      });
      if (status === 404) return c.json({ error: `session not found: ${id}` }, 404);
      if (status === 409) return c.json({ error: NOT_CLOSED }, 409);
      return c.json({ ok: true });
    });
}
