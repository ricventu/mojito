import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@mojito/shared";
import { TOKEN, setup } from "./setup";

const png = (name = "a.png", bytes = 4) => new File([new Uint8Array(bytes)], name, { type: "image/png" });

function form(fields: { project?: string; note?: string; images?: File[] }) {
  const fd = new FormData();
  if (fields.project !== undefined) fd.append("project", fields.project);
  if (fields.note !== undefined) fd.append("note", fields.note);
  for (const f of fields.images ?? []) fd.append("images[]", f);
  return fd;
}

function withProject() {
  const s = setup();
  s.projects.upsert({ name: "Web", path: "/repo/web", teamKey: "RIC" });
  const post = (fd: FormData) => s.app.request("/api/tasks", { method: "POST", headers: { "x-mojito-token": TOKEN }, body: fd });
  return { ...s, post };
}

const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "t1",
  type: "create-ticket",
  input: { project: "Web", note: "n", imageUrls: [] },
  status: "failed",
  log: [],
  error: "x",
  result: null,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("POST /api/tasks", () => {
  it("uploads the images, stores the task queued and enqueues it", async () => {
    const { post, linear, tasks, taskQueue } = withProject();
    linear.uploadImage.mockResolvedValueOnce("https://uploads.linear.app/1").mockResolvedValueOnce("https://uploads.linear.app/2");
    const res = await post(form({ project: "Web", note: "  il salva non va  ", images: [png("a.png"), png("b.png")] }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as TaskRecord;
    expect(body).toMatchObject({
      type: "create-ticket",
      status: "queued",
      input: { project: "Web", note: "il salva non va", imageUrls: ["https://uploads.linear.app/1", "https://uploads.linear.app/2"] },
      log: [],
      error: null,
      result: null,
      archived: false,
      createdAt: 2000,
    });
    expect(linear.uploadImage).toHaveBeenCalledWith({ filename: "a.png", contentType: "image/png", size: 4, bytes: expect.any(Uint8Array) });
    expect(tasks.get(body.id)).toEqual(body);
    expect(taskQueue.enqueue).toHaveBeenCalledWith(body.id);
  });

  it("takes a note without images", async () => {
    const { post, linear } = withProject();
    const res = await post(form({ project: "Web", note: "solo testo" }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as TaskRecord).input.imageUrls).toEqual([]);
    expect(linear.uploadImage).not.toHaveBeenCalled();
  });

  it("answers 502 and stores nothing when an upload fails", async () => {
    const { post, linear, tasks, taskQueue } = withProject();
    linear.uploadImage.mockResolvedValueOnce("https://uploads.linear.app/1").mockRejectedValueOnce(new Error("Linear asset upload failed: 500"));
    const res = await post(form({ project: "Web", note: "n", images: [png("a.png"), png("b.png")] }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Linear asset upload failed: 500" });
    expect(tasks.list()).toEqual([]);
    expect(taskQueue.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a PDF before uploading anything", async () => {
    const { post, linear, tasks } = withProject();
    const pdf = new File([new Uint8Array(4)], "doc.pdf", { type: "application/pdf" });
    const res = await post(form({ project: "Web", note: "n", images: [png(), pdf] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "tipo non supportato: application/pdf" });
    expect(linear.uploadImage).not.toHaveBeenCalled();
    expect(tasks.list()).toEqual([]);
  });

  it("refuses eleven images before uploading anything", async () => {
    const { post, linear } = withProject();
    const res = await post(form({ project: "Web", note: "n", images: Array.from({ length: 11 }, (_, i) => png(`${i}.png`)) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "troppe immagini (max 10)" });
    expect(linear.uploadImage).not.toHaveBeenCalled();
  });

  it("refuses an 11 MB image before uploading anything", async () => {
    const { post, linear } = withProject();
    const res = await post(form({ project: "Web", note: "n", images: [png(), png("big.png", 11 * 1024 * 1024)] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "immagine troppo grande: big.png" });
    expect(linear.uploadImage).not.toHaveBeenCalled();
  });

  it("refuses an unknown project and an empty note", async () => {
    const { post, linear } = withProject();
    const unknown = await post(form({ project: "Nope", note: "n" }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "progetto sconosciuto: Nope" });
    const empty = await post(form({ project: "Web", note: "   " }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "la nota è vuota" });
    expect(linear.uploadImage).not.toHaveBeenCalled();
  });

  it("refuses a text value where an image belongs", async () => {
    const { post } = withProject();
    const fd = form({ project: "Web", note: "n" });
    fd.append("images[]", "not a file");
    const res = await post(fd);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tasks", () => {
  it("lists the tasks that are not archived", async () => {
    const { req, tasks } = setup();
    tasks.insert(task({ id: "a" }));
    tasks.insert(task({ id: "b", archived: true }));
    const res = await req("/api/tasks");
    expect(res.status).toBe(200);
    expect(((await res.json()) as TaskRecord[]).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("POST /api/tasks/:id/retry", () => {
  it("answers the requeued task", async () => {
    const { req, tasks, taskQueue } = setup();
    tasks.insert(task());
    taskQueue.retry.mockImplementation((id: string) => {
      tasks.update(id, { status: "queued", error: null });
      return true;
    });
    const res = await req("/api/tasks/t1/retry", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "t1", status: "queued" });
    expect(taskQueue.retry).toHaveBeenCalledWith("t1");
  });

  it("answers 404 for an unknown task and 409 for one that did not fail", async () => {
    const { req, tasks, taskQueue } = setup();
    expect((await req("/api/tasks/nope/retry", { method: "POST" })).status).toBe(404);
    tasks.insert(task({ status: "done" }));
    taskQueue.retry.mockReturnValue(false);
    const res = await req("/api/tasks/t1/retry", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "task not failed: t1" });
  });
});

describe("POST /api/tasks/:id/archive", () => {
  it("archives the task and announces it", async () => {
    const { req, tasks, events } = setup();
    tasks.insert(task());
    const res = await req("/api/tasks/t1/archive", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "t1", archived: true, updatedAt: 2000 });
    expect(tasks.get("t1")!.archived).toBe(true);
    expect(events).toContainEqual({ type: "task.updated", task: expect.objectContaining({ id: "t1", archived: true }) });
  });

  it("answers 404 for an unknown task", async () => {
    const { req } = setup();
    expect((await req("/api/tasks/nope/archive", { method: "POST" })).status).toBe(404);
  });
});
