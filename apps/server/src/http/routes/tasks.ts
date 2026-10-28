import { randomUUID } from "node:crypto";
import type { TaskRecord } from "@mojito/shared";
import { Hono } from "hono";
import { validateImages } from "../../tasks/images";
import type { AppDeps } from "../app";
import { errorMessage } from "../body";

const asList = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** The create-ticket tasks: the New-ticket sheet's submission and the cards that follow it. */
export function taskRoutes(deps: AppDeps): Hono {
  const now = () => (deps.now ?? Date.now)();

  const announce = (task: TaskRecord) => deps.bus.emit({ type: "task.updated", task });

  return new Hono()
    .get("/tasks", (c) => c.json(deps.tasks.list().filter((t) => !t.archived)))
    .post("/tasks", async (c) => {
      const body = await c.req.parseBody({ all: true });
      const name = asString(body.project);
      const note = asString(body.note).trim();
      const entries = [...asList(body["images[]"]), ...asList(body.images)];
      if (!deps.projects.get(name)) return c.json({ error: `progetto sconosciuto: ${name}` }, 400);
      if (!note) return c.json({ error: "la nota è vuota" }, 400);
      if (entries.some((e) => !(e instanceof File))) return c.json({ error: "immagine non valida" }, 400);
      const files = entries as File[];
      const valid = validateImages(files);
      if (!valid.ok) return c.json({ error: valid.error }, 400);

      // Every image reaches Linear before the task exists: one that fails leaves no task behind,
      // and a retry later never has to upload anything again.
      const imageUrls: string[] = [];
      try {
        for (const f of files) {
          imageUrls.push(
            await deps.linear.uploadImage({ filename: f.name, contentType: f.type, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) }),
          );
        }
      } catch (err) {
        return c.json({ error: errorMessage(err) }, 502);
      }

      const at = now();
      const task: TaskRecord = {
        id: randomUUID(),
        type: "create-ticket",
        input: { project: name, note, imageUrls },
        status: "queued",
        log: [],
        error: null,
        result: null,
        archived: false,
        createdAt: at,
        updatedAt: at,
      };
      deps.tasks.insert(task);
      announce(task);
      deps.taskQueue.enqueue(task.id);
      return c.json(task, 201);
    })
    .post("/tasks/:id/retry", (c) => {
      const id = c.req.param("id");
      if (!deps.tasks.get(id)) return c.json({ error: `task not found: ${id}` }, 404);
      if (!deps.taskQueue.retry(id)) return c.json({ error: `task not failed: ${id}` }, 409);
      return c.json(deps.tasks.get(id));
    })
    .post("/tasks/:id/archive", (c) => {
      const id = c.req.param("id");
      const task = deps.tasks.update(id, { archived: true, updatedAt: now() });
      if (!task) return c.json({ error: `task not found: ${id}` }, 404);
      announce(task);
      return c.json(task);
    });
}
