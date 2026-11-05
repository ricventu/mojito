import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { LaunchBody } from "@mojito/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { parseBody } from "../body";
import { expandHome } from "../../homePath";
import { imagesDir, storeAttachments, validateAttachments } from "../../sessions/images";
import { launchFree, launchTicket, resumeSession } from "../../sessions/launch";
import { readImageFile, resolveImagePath } from "../../sessions/viewImage";

const IMAGE_ERRORS = {
  "not-found": [404, "image not found"],
  "too-large": [413, "image too large"],
  "not-image": [415, "not an image"],
} as const;

const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function sessionRoutes(deps: AppDeps): Hono {
  const removeFile = deps.removeFile ?? ((path: string) => rmSync(path, { recursive: true, force: true }));

  // Forgetting an ended session: its row, the hook settings it was launched with (which carry
  // the token), and the files attached to it. Only an ended one — a live session's row is how
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
        ["attachments", imagesDir(deps.cfg.stateDir, id)],
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
    // Images and PDFs for claude: claude's own image paste reads this machine's clipboard, never
    // the browser's, so the client uploads them here and pastes the returned paths into the
    // terminal. The route keeps its name: renaming it would refuse images to an older peer.
    .post("/sessions/:id/images", async (c) => {
      const id = c.req.param("id");
      const row = deps.sessions.get(id);
      if (!row || basename(id) !== id) return c.json({ error: `session not found: ${id}` }, 404);
      if (row.state === "ended") return c.json({ error: `session ended: ${id}` }, 409);
      const body = await c.req.parseBody({ all: true });
      const entries = [...asList(body["images[]"]), ...asList(body.images)];
      if (entries.some((e) => !(e instanceof File))) return c.json({ error: "invalid file" }, 400);
      const files = entries as File[];
      if (files.length === 0) return c.json({ error: "no files" }, 400);
      const valid = validateAttachments(files);
      if (!valid.ok) return c.json({ error: valid.error }, 400);
      const attachments = await Promise.all(
        files.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
      );
      return c.json({ paths: storeAttachments(imagesDir(deps.cfg.stateDir, id), attachments) }, 201);
    })
    // An image path claude printed, for the terminal's viewer (resolveImagePath: where it may
    // be, readImageFile: what may be served). Sandboxed and never sniffed, so the answer can
    // only ever render as the image its bytes declare.
    .get("/sessions/:id/image", (c) => {
      const id = c.req.param("id");
      const row = deps.sessions.get(id);
      if (!row) return c.json({ error: `session not found: ${id}` }, 404);
      const path = c.req.query("path");
      if (!path) return c.json({ error: "path is required" }, 400);
      const abs = resolveImagePath(path, expandHome(row.cwd, deps.cfg.home), deps.cfg.home);
      if (!abs) return c.json({ error: "not an image path" }, 400);
      const read = readImageFile(abs);
      if (!read.ok) {
        const [status, error] = IMAGE_ERRORS[read.reason];
        return c.json({ error }, status);
      }
      return c.body(new Uint8Array(read.bytes), 200, {
        "content-type": read.type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "no-store",
      });
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
    // An ended claude session started again on its own conversation (launch.ts#resumeSession).
    .post("/sessions/:id/resume", async (c) => {
      const result = await resumeSession(c.req.param("id"), deps.launch);
      if (!result.ok) {
        const { status, error, sessionId } = result;
        return c.json(sessionId === undefined ? { error } : { error, sessionId }, status);
      }
      return c.json({ session: result.session }, 201);
    })
    // There is no Kill: a session ends when claude is quit in its terminal. DELETE only forgets
    // an ended one (`remove`).
    .delete("/sessions/:id", (c) => {
      const r = remove(c.req.param("id"));
      return r.status === 200 ? c.json({ ok: true }) : c.json({ error: r.error }, r.status);
    });
}
