import { afterEach, describe, expect, it, vi } from "vitest";
import type { MojitoEvent, TaskRecord } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { ProjectsRepo } from "../../src/db/projects";
import { TasksRepo } from "../../src/db/tasks";
import { EventBus } from "../../src/events/bus";
import { TaskQueue, type QueryFn } from "../../src/tasks/runner";
import { callTool } from "./mcp";

type Params = Parameters<QueryFn>[0];

const assistant = (content: unknown[]) => ({ type: "assistant", message: { content }, parent_tool_use_id: null });
const result = (text: string) => ({ type: "result", subtype: "success", is_error: false, result: text });

/** A model that says something, calls create_issue through the real handler, then ends. */
const creatingModel = async function* (p: Params) {
  for await (const _ of p.prompt as AsyncIterable<unknown>) break;
  yield assistant([{ type: "text", text: "Creo il ticket." }, { type: "tool_use", name: "mcp__mojito-linear__create_issue", id: "t1", input: {} }]);
  await callTool(p.options!.mcpServers!["mojito-linear"], "create_issue", { team: "RIC", project: "Web", title: "T", description: "D" });
  yield result("Creato RIC-9");
};

function setup(over: { query?: (p: Params) => AsyncGenerator<unknown>; concurrency?: number } = {}) {
  const db = openDb(":memory:");
  const tasks = new TasksRepo(db);
  const projects = new ProjectsRepo(db);
  projects.upsert({ name: "Web", path: "/repo/web", teamKey: "RIC" });
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const linear = {
    listLabels: vi.fn(async () => []),
    createIssue: vi.fn(async () => ({ identifier: "RIC-9", url: "https://linear.app/x/issue/RIC-9" })),
  };
  const tickets = { refresh: vi.fn(async () => {}) };
  const query = vi.fn(over.query ?? creatingModel);
  const fetchImage = vi.fn(async (_url: string) => ({ mediaType: "image/png", base64: "AAA" }));
  const queue = new TaskQueue({
    tasks,
    projects,
    linear,
    bus,
    tickets,
    query: query as unknown as QueryFn,
    fetchImage,
    now: () => 5000,
    ...(over.concurrency !== undefined ? { concurrency: over.concurrency } : {}),
  });
  const add = (id: string, input: Partial<TaskRecord["input"]> = {}) => {
    tasks.insert({
      id,
      type: "create-ticket",
      input: { project: "Web", note: "nota", imageUrls: [], ...input },
      status: "queued",
      log: [],
      error: null,
      result: null,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
    });
  };
  const statuses = (id: string) =>
    events.flatMap((e) => (e.type === "task.updated" && e.task.id === id ? [e.task.status] : [])).filter((s, i, a) => a[i - 1] !== s);
  return { tasks, bus, events, linear, tickets, query, fetchImage, queue, add, statuses };
}

const settled = async (tasks: TasksRepo, id: string) =>
  vi.waitFor(() => {
    const s = tasks.get(id)!.status;
    if (s !== "done" && s !== "failed") throw new Error(`still ${s}`);
  });

afterEach(() => {
  delete process.env.LINEAR_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

describe("TaskQueue", () => {
  it("runs a task to done with the created ticket, a log, and a board refresh", async () => {
    const { tasks, queue, add, statuses, tickets, linear } = setup();
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    const t = tasks.get("t1")!;
    expect(t.status).toBe("done");
    expect(t.result).toEqual({ identifier: "RIC-9", url: "https://linear.app/x/issue/RIC-9" });
    expect(t.error).toBeNull();
    expect(t.log).toContain("Creo il ticket.");
    expect(t.log).toContain("→ create_issue");
    expect(t.updatedAt).toBe(5000);
    expect(statuses("t1")).toEqual(["running", "done"]);
    expect(linear.createIssue).toHaveBeenCalledTimes(1);
    expect(tickets.refresh).toHaveBeenCalled();
  });

  it("passes the isolated options and a scrubbed environment to query", async () => {
    process.env.LINEAR_API_KEY = "lin_secret";
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
    process.env.ANTHROPIC_AUTH_TOKEN = "tok-secret";
    const { tasks, queue, add, query } = setup();
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    const options = query.mock.calls[0][0].options!;
    expect(options).toMatchObject({
      model: "sonnet",
      settingSources: [],
      tools: [],
      allowedTools: ["mcp__mojito-linear__*"],
      maxTurns: 10,
    });
    expect(typeof options.systemPrompt).toBe("string");
    expect(Object.keys(options.mcpServers!)).toEqual(["mojito-linear"]);
    expect(options.env).toBeDefined();
    expect(options.env).not.toHaveProperty("LINEAR_API_KEY");
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(options.env).toHaveProperty("PATH");
  });

  it("downloads the images and hands them to the model", async () => {
    let seen: unknown;
    const { tasks, queue, add, fetchImage } = setup({
      query: async function* (p) {
        for await (const m of p.prompt as AsyncIterable<unknown>) seen = m;
        yield result("niente");
      },
    });
    add("t1", { imageUrls: ["https://uploads.linear.app/a.png"] });
    queue.enqueue("t1");
    await settled(tasks, "t1");
    expect(fetchImage).toHaveBeenCalledWith("https://uploads.linear.app/a.png");
    const content = (seen as { message: { content: { type: string }[] } }).message.content;
    expect(content.filter((b) => b.type === "image")).toHaveLength(1);
  });

  it("fails with the result text when no ticket was created", async () => {
    const { tasks, queue, add, tickets } = setup({
      query: async function* () {
        yield result("La nota è vuota.");
      },
    });
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    expect(tasks.get("t1")).toMatchObject({ status: "failed", error: "La nota è vuota.", result: null });
    expect(tickets.refresh).not.toHaveBeenCalled();
  });

  it("fails with a default message when nothing was created and nothing said", async () => {
    const { tasks, queue, add } = setup({ query: async function* () {} });
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    expect(tasks.get("t1")).toMatchObject({ status: "failed", error: "nessun ticket creato" });
  });

  it("is done, not failed, when the ticket was created before something threw", async () => {
    const { tasks, queue, add, tickets, linear } = setup({
      query: async function* (p) {
        yield* creatingModel(p);
        throw new Error("process exited with code 1");
      },
    });
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    const t = tasks.get("t1")!;
    expect(t).toMatchObject({ status: "done", error: null, result: { identifier: "RIC-9", url: "https://linear.app/x/issue/RIC-9" } });
    expect(t.log).toContain("errore dopo la creazione: process exited with code 1");
    expect(tickets.refresh).toHaveBeenCalled();
    expect(queue.retry("t1")).toBe(false);
    expect(linear.createIssue).toHaveBeenCalledTimes(1);
  });

  it("fails with the thrown message", async () => {
    const { tasks, queue, add, statuses } = setup({
      query: () => {
        throw new Error("Not logged in");
      },
    });
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    expect(tasks.get("t1")).toMatchObject({ status: "failed", error: "Not logged in" });
    expect(statuses("t1")).toEqual(["running", "failed"]);
  });

  it("runs at most two at once: the third waits queued for a free slot", async () => {
    const gates: (() => void)[] = [];
    const { tasks, queue, add } = setup({
      query: async function* (p) {
        await new Promise<void>((r) => gates.push(r));
        yield* creatingModel(p);
      },
    });
    for (const id of ["a", "b", "c"]) add(id);
    for (const id of ["a", "b", "c"]) queue.enqueue(id);
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(tasks.get("a")!.status).toBe("running");
    expect(tasks.get("b")!.status).toBe("running");
    expect(tasks.get("c")!.status).toBe("queued");
    gates[0]();
    await settled(tasks, "a");
    await vi.waitFor(() => expect(tasks.get("c")!.status).toBe("running"));
    gates[1]();
    await vi.waitFor(() => expect(gates).toHaveLength(3));
    gates[2]();
    await settled(tasks, "b");
    await settled(tasks, "c");
  });

  it("retry is refused on a task that did not fail", async () => {
    const { tasks, queue, add } = setup();
    add("t1");
    queue.enqueue("t1");
    await settled(tasks, "t1");
    expect(queue.retry("t1")).toBe(false);
    expect(queue.retry("missing")).toBe(false);
    expect(tasks.get("t1")!.status).toBe("done");
  });

  it("retry requeues a failed task with the same input and runs it again", async () => {
    let calls = 0;
    const { tasks, queue, add, statuses } = setup({
      query: async function* (p) {
        if (calls++ === 0) throw new Error("rate limit");
        yield* creatingModel(p);
      },
    });
    add("t1", { imageUrls: ["https://uploads.linear.app/a.png"] });
    queue.enqueue("t1");
    await settled(tasks, "t1");
    expect(tasks.get("t1")!.status).toBe("failed");
    expect(queue.retry("t1")).toBe(true);
    await vi.waitFor(() => expect(tasks.get("t1")!.status).toBe("done"));
    const t = tasks.get("t1")!;
    expect(t.error).toBeNull();
    expect(t.input.imageUrls).toEqual(["https://uploads.linear.app/a.png"]);
    expect(t.log).toContain("— riprova —");
    expect(statuses("t1")).toEqual(["running", "failed", "queued", "running", "done"]);
  });
});
