import { DEFAULT_COMMANDS } from "@mojito/shared";
import { describe, expect, it, vi } from "vitest";
import { AssistError } from "../../src/commands/assist";
import { meta, setup } from "./setup";

const web = { name: "Web", path: "~/repo/web", teamKey: "RIC" };
const custom = { id: "cmd-a1b2c3", name: "Lint", prompt: "run lint", icon: "bug" as const, project: "Api", excluded: [], model: "sonnet" as const, effort: "low" as const };

const run = (ctx: ReturnType<typeof setup>, id: string, project = "Web") =>
  ctx.req(`/api/projects/${encodeURIComponent(project)}/commands/${id}`, { method: "POST" });

describe("GET /api/commands", () => {
  it("lists the commands in force", async () => {
    const ctx = setup();
    const res = await ctx.req("/api/commands");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ commands: [...DEFAULT_COMMANDS] });
  });
});

describe("POST /api/projects/:name/commands/:id", () => {
  it("opens the project's clean session and answers it", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    const res = await run(ctx, "clean");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyOpen: false, session: { id: "mj-web-clean", project: "Web" } });
    expect(ctx.launch.newSession).toHaveBeenCalledWith("mj-web-clean", "/home/me/repo/web", expect.stringContaining("fetch --prune"));
  });

  it("answers the session already open", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    const live = meta({ id: "mj-web-clean", kind: "claude", ticket: null, state: "idle" });
    ctx.sessions.insert(live);
    expect(await (await run(ctx, "clean")).json()).toEqual({ alreadyOpen: true, session: live });
  });

  it("refuses a live row that is not this command's", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    ctx.sessions.insert(meta({ id: "mj-web-clean", kind: "claude", ticket: null, project: "Web-clean", state: "idle" }));
    const res = await run(ctx, "clean");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "another session holds mj-web-clean", sessionId: "mj-web-clean" });
  });

  it("404s an unknown project", async () => {
    const ctx = setup();
    const res = await run(ctx, "clean", "Nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project not found: Nope" });
  });

  it("400s a project whose path is gone", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    ctx.exists.mockReturnValue(false);
    expect((await run(ctx, "clean")).status).toBe(400);
  });

  it("404s a command bound to another project", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    ctx.settings.setCommands({ items: [custom], removed: [] });
    const res = await run(ctx, custom.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: `command not found: ${custom.id}` });
  });

  it("404s a general command that excludes the project, runs it elsewhere", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    ctx.settings.setCommands({ items: [{ ...DEFAULT_COMMANDS[0], excluded: [web.name] }], removed: [] });
    expect((await run(ctx, "clean")).status).toBe(404);
    ctx.settings.setCommands({ items: [{ ...DEFAULT_COMMANDS[0], excluded: ["Other"] }], removed: [] });
    expect((await run(ctx, "clean")).status).toBe(200);
  });

  it("404s a removed default", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    ctx.settings.setCommands({ items: [], removed: ["clean"] });
    expect((await run(ctx, "clean")).status).toBe(404);
  });

  it("runs an edited default with its own model", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    ctx.settings.setCommands({ items: [{ ...DEFAULT_COMMANDS[0], model: "opus" }], removed: [] });
    const res = await run(ctx, "clean");
    expect(await res.json()).toMatchObject({ session: { model: "opus" } });
  });
});

describe("POST /api/commands/assist", () => {
  const post = (ctx: ReturnType<typeof setup>, json: unknown) => ctx.req("/api/commands/assist", { method: "POST", json });

  it("answers the assistant's proposal", async () => {
    const answer = { name: "Deps", prompt: "Update.", icon: "package" as const };
    const assist = vi.fn(async () => answer);
    const res = await post(setup({ assist }), { text: "update deps", project: "Web" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    expect(assist).toHaveBeenCalledWith({ text: "update deps", project: "Web" });
  });

  it("400s an empty text", async () => {
    const assist = vi.fn();
    const res = await post(setup({ assist }), { text: "   " });
    expect(res.status).toBe(400);
    expect(assist).not.toHaveBeenCalled();
  });

  it("502s an AssistError", async () => {
    const res = await post(setup({ assist: async () => { throw new AssistError("the assistant timed out"); } }), { text: "x" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "the assistant timed out" });
  });
});
