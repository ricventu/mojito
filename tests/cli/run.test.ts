import { describe, it, expect } from "vitest";
import { runMojitoCli, type CliDeps } from "@/cli/run";

const MOJITO = { name: "Mojito", path: "/repo/mojito" };

interface Call { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }

function deps(over: Partial<CliDeps> = {}, calls: Call[] = [], out: string[] = [], opened: string[] = []): CliDeps {
  return {
    envFilePath: "/repo/mojito/.env.local",
    env: { MOJITO_TOKEN: "sekret" },
    gitPaths: () => ({ toplevel: "/repo/mojito", mainRepo: "/repo/mojito" }),
    projects: () => [MOJITO],
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/api/health")) return { ok: true, status: 200, text: async () => "ok" };
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: "mojito-custom-mojito-ab12" }) };
    },
    openUrl: (url) => opened.push(url),
    log: (line) => out.push(line),
    ...over,
  };
}

function body(calls: Call[]): Record<string, unknown> {
  const post = calls.find((c) => c.init?.method === "POST");
  return JSON.parse(post?.init?.body ?? "{}");
}

describe("runMojitoCli", () => {
  it("posts a project-scoped claude session and opens its terminal", async () => {
    const calls: Call[] = []; const opened: string[] = [];
    const code = await runMojitoCli([], deps({}, calls, [], opened));
    expect(code).toBe(0);
    expect(body(calls)).toEqual({ kind: "custom", projectName: "Mojito", model: "opus", effort: "high" });
    expect(opened).toEqual(["http://127.0.0.1:4711/session/mojito-custom-mojito-ab12?token=sekret"]);
  });

  it("authenticates the launch with the token from .env.local", async () => {
    const calls: Call[] = [];
    await runMojitoCli([], deps({}, calls));
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.init?.headers?.["x-mojito-token"]).toBe("sekret");
  });

  it("checks health before launching anything", async () => {
    const calls: Call[] = [];
    await runMojitoCli([], deps({}, calls));
    expect(calls[0].url).toBe("http://127.0.0.1:4711/api/health");
  });

  it("carries the cwd's worktree when it is a linked worktree of the mapped repo", async () => {
    const calls: Call[] = [];
    await runMojitoCli([], deps({
      gitPaths: () => ({ toplevel: "/repo/mojito/.claude/worktrees/RIC-1-x", mainRepo: "/repo/mojito" }),
    }, calls));
    expect(body(calls).worktree).toBe("/repo/mojito/.claude/worktrees/RIC-1-x");
  });

  it("omits worktree entirely at the repo root, rather than sending an empty one", async () => {
    const calls: Call[] = [];
    await runMojitoCli([], deps({}, calls));
    expect(body(calls)).not.toHaveProperty("worktree");
  });

  it("falls back to a General session for an unmapped folder, and says where it lands", async () => {
    const calls: Call[] = []; const out: string[] = [];
    const code = await runMojitoCli([], deps({
      gitPaths: () => ({ toplevel: "/repo/stranger", mainRepo: "/repo/stranger" }),
    }, calls, out));
    expect(code).toBe(0);
    expect(body(calls)).toEqual({ kind: "custom", projectName: null, model: "opus", effort: "high" });
    expect(out.join("\n")).toContain("/repo/stranger is not a mapped project");
    expect(out.join("\n")).toContain("General session in ~");
  });

  it("sends no worktree with a General session, which would ignore it anyway", async () => {
    const calls: Call[] = [];
    await runMojitoCli([], deps({
      gitPaths: () => ({ toplevel: "/repo/stranger/wt", mainRepo: "/repo/stranger" }),
    }, calls));
    expect(body(calls)).not.toHaveProperty("worktree");
  });

  it("launches a plain terminal on --shell, with no model or effort to answer for", async () => {
    const calls: Call[] = [];
    await runMojitoCli(["--shell"], deps({}, calls));
    expect(body(calls)).toEqual({ kind: "shell", projectName: "Mojito" });
  });

  it("refuses to launch when the server is down, and names the way to start it", async () => {
    const calls: Call[] = []; const out: string[] = [];
    const code = await runMojitoCli([], deps({
      fetch: async (url) => { calls.push({ url }); throw new Error("ECONNREFUSED"); },
    }, calls, out));
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(out.join("\n")).toContain("4711");
    expect(out.join("\n")).toContain("make prod");
  });

  it("treats an unhealthy answer as down", async () => {
    const calls: Call[] = [];
    const code = await runMojitoCli([], deps({
      fetch: async (url) => { calls.push({ url }); return { ok: false, status: 500, text: async () => "boom" }; },
    }, calls));
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("surfaces a refused launch with its status and body instead of opening a tab", async () => {
    const opened: string[] = []; const out: string[] = [];
    const code = await runMojitoCli([], deps({
      fetch: async (url) => url.endsWith("/api/health")
        ? { ok: true, status: 200, text: async () => "ok" }
        : { ok: false, status: 422, text: async () => '{"error":"no-repo"}' },
    }, [], out, opened));
    expect(code).toBe(1);
    expect(opened).toEqual([]);
    expect(out.join("\n")).toContain("422");
    expect(out.join("\n")).toContain("no-repo");
  });

  it("prints the url instead of opening it on --print", async () => {
    const opened: string[] = []; const out: string[] = [];
    const code = await runMojitoCli(["--print"], deps({}, [], out, opened));
    expect(code).toBe(0);
    expect(opened).toEqual([]);
    expect(out.join("\n")).toContain("http://127.0.0.1:4711/session/mojito-custom-mojito-ab12?token=sekret");
  });

  it("honours MOJITO_PORT, so the CLI and the server cannot disagree about the port", async () => {
    const calls: Call[] = [];
    await runMojitoCli([], deps({ env: { MOJITO_TOKEN: "sekret", MOJITO_PORT: "5000" } }, calls));
    expect(calls[0].url).toBe("http://127.0.0.1:5000/api/health");
  });

  it("refuses without a token, naming the file it read", async () => {
    const calls: Call[] = []; const out: string[] = [];
    const code = await runMojitoCli([], deps({ env: {} }, calls, out));
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(out.join("\n")).toContain("/repo/mojito/.env.local");
  });

  it("reports a bad flag without touching the server", async () => {
    const calls: Call[] = []; const out: string[] = [];
    const code = await runMojitoCli(["--nope"], deps({}, calls, out));
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(out.join("\n")).toContain("unknown option: --nope");
  });

  it("prints usage on --help and launches nothing", async () => {
    const calls: Call[] = []; const out: string[] = [];
    const code = await runMojitoCli(["--help"], deps({}, calls, out));
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(out.join("\n")).toContain("--shell");
  });
});
