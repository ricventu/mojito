import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { LaunchBody, SessionPatchBody } from "@mojito/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { parseBody } from "../body";
import { killSession } from "../../sessions/close";
import { imagesDir, storeImages } from "../../sessions/images";
import { launchFree, launchTicket } from "../../sessions/launch";
import { validateImages, type ImageType } from "../../tasks/images";

const NOT_CLOSED = "claude did not exit: open the terminal";

const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function sessionRoutes(deps: AppDeps): Hono {
  const removeFile = deps.removeFile ?? ((path: string) => rmSync(path, { recursive: true, force: true }));

  // Forgetting an ended session: its row, the hook settings it was launched with (which carry
  // the token), and the images pasted into it. Only an ended one — a live session's row is how
  // the board reaches it.
  const remove = (id: string): { status: 200 } | { status: 404 | 409; error: string } => {
    const row = deps.sessions.get(id);
    if (!row) return { status: 404, error: `session not found: ${id}` };
    if (row.state !== "ended") return { status: 409, error: `session not ended: ${id}` };
    deps.sessions.remove(id);
    deps.bus.emit({ type: "session.removed", id });
    // A row id is a tmux name and never a path, but it is about to become one.
    if (basename(id) === id) {
      for (const [what, path] of [
        ["hook settings", join(deps.cfg.stateDir, "hooks", `${id}.json`)],
        ["images", imagesDir(deps.cfg.stateDir, id)],
      ]) {
        try {
          removeFile(path);
        } catch (err) {
          console.error(`could not delete ${what} of ${id}:`, err);
        }
      }
    }
    return { status: 200 };
  };

  return new Hono()
    .get("/sessions", (c) => c.json(deps.sessions.list()))
    // Images for claude: claude's own image paste reads this machine's clipboard, never the
    // browser's, so the client uploads them here and pastes the returned paths into the terminal.
    .post("/sessions/:id/images", async (c) => {
      const id = c.req.param("id");
      const row = deps.sessions.get(id);
      if (!row || basename(id) !== id) return c.json({ error: `session not found: ${id}` }, 404);
      if (row.state === "ended") return c.json({ error: `session ended: ${id}` }, 409);
      const body = await c.req.parseBody({ all: true });
      const entries = [...asList(body["images[]"]), ...asList(body.images)];
      if (entries.some((e) => !(e instanceof File))) return c.json({ error: "invalid image" }, 400);
      const files = entries as File[];
      if (files.length === 0) return c.json({ error: "no images" }, 400);
      const valid = validateImages(files);
      if (!valid.ok) return c.json({ error: valid.error }, 400);
      const images = await Promise.all(
        files.map(async (f) => ({ type: f.type as ImageType, bytes: new Uint8Array(await f.arrayBuffer()) })),
      );
      return c.json({ paths: storeImages(imagesDir(deps.cfg.stateDir, id), images) }, 201);
    })
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
    .patch("/sessions/:id", async (c) => {
      const id = c.req.param("id");
      if (!deps.sessions.get(id)) return c.json({ error: `session not found: ${id}` }, 404);
      const body = await parseBody(c, SessionPatchBody);
      if (!body.ok) return c.json({ error: body.error }, 400);
      const session = deps.sessions.patch(id, { hidden: body.data.hidden });
      if (!session) return c.json({ error: `session not found: ${id}` }, 404);
      deps.bus.emit({ type: "session.updated", session });
      return c.json(session);
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
