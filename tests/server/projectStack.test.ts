import { describe, it, expect } from "vitest";
import { listStacks, resolveStack, startStack, stopStack, type StackDeps } from "@/server/projectStack";

// A fake project map: Mojito (self), Factorybook (has start.sh), Lime (no start.sh),
// "Gestionale Cooperative" (has start.sh, space in name -> slug check).
const SELF = "/repo/mojito";
const MAP = {
  RIC: {
    projects: {
      Mojito: "/repo/mojito",
      Factorybook: "/repo/fb",
      Lime: "/repo/lime",
      "Gestionale Cooperative": "/repo/gc",
    },
  },
};
const EXECUTABLE = new Set(["/repo/fb/scripts/start.sh", "/repo/gc/scripts/start.sh"]);

function deps(over: Partial<StackDeps> = {}): StackDeps {
  return {
    projectsPath: "/ignored",
    selfPath: SELF,
    loadMap: () => MAP as never,
    isExecutable: (p) => EXECUTABLE.has(p),
    hasSession: async () => false,
    panesDead: async () => "",
    startSession: async () => {},
    killSession: async () => {},
    ...over,
  };
}

describe("listStacks", () => {
  it("lists every mapped project sorted by name, with hasStack + pullable", async () => {
    const rows = await listStacks(deps());
    expect(rows.map((r) => r.project)).toEqual([
      "Factorybook", "Gestionale Cooperative", "Lime", "Mojito",
    ]);
    const fb = rows.find((r) => r.project === "Factorybook")!;
    expect(fb).toMatchObject({ slug: "factorybook", hasStack: true, pullable: true });
    const gc = rows.find((r) => r.project === "Gestionale Cooperative")!;
    expect(gc.slug).toBe("gestionale-cooperative");
    const lime = rows.find((r) => r.project === "Lime")!;
    expect(lime).toMatchObject({ hasStack: false, status: null, pullable: true });
  });

  it("flags the Mojito self-row (path === selfPath) as not pullable", async () => {
    const rows = await listStacks(deps());
    const mojito = rows.find((r) => r.project === "Mojito")!;
    expect(mojito.pullable).toBe(false);
  });

  it("derives status: no session -> stopped; live pane -> running; dead pane -> crashed", async () => {
    const running = await listStacks(deps({ hasSession: async () => true, panesDead: async () => "0\n" }));
    expect(running.find((r) => r.project === "Factorybook")!.status).toBe("running");
    const crashed = await listStacks(deps({ hasSession: async () => true, panesDead: async () => "1\n" }));
    expect(crashed.find((r) => r.project === "Factorybook")!.status).toBe("crashed");
    const stopped = await listStacks(deps({ hasSession: async () => false }));
    expect(stopped.find((r) => r.project === "Factorybook")!.status).toBe("stopped");
  });

  it("leaves status null for projects without start.sh", async () => {
    const rows = await listStacks(deps({ hasSession: async () => true, panesDead: async () => "0\n" }));
    expect(rows.find((r) => r.project === "Lime")!.status).toBeNull();
  });
});

describe("resolveStack", () => {
  it("finds a project by slug and reports hasStack + pullable", () => {
    expect(resolveStack("factorybook", deps())).toEqual({
      project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true,
    });
    expect(resolveStack("mojito", deps())).toMatchObject({ pullable: false });
  });
  it("returns null for an unknown slug", () => {
    expect(resolveStack("nope", deps())).toBeNull();
  });
});

describe("startStack", () => {
  it("404 when the project has no start.sh", async () => {
    const r = await startStack("lime", deps());
    expect(r).toEqual({ ok: false, error: "no stack", code: 404 });
  });
  it("404 for an unknown slug", async () => {
    expect(await startStack("nope", deps())).toEqual({ ok: false, error: "no stack", code: 404 });
  });
  it("409 when already running", async () => {
    const r = await startStack("factorybook", deps({ hasSession: async () => true }));
    expect(r).toEqual({ ok: false, error: "already running", code: 409 });
  });
  it("starts the stack and returns running", async () => {
    const calls: Array<[string, string, string]> = [];
    const r = await startStack("factorybook", deps({
      hasSession: async () => false,
      startSession: async (n, c, cmd) => { calls.push([n, c, cmd]); },
    }));
    expect(r).toEqual({ ok: true, status: "running" });
    expect(calls).toEqual([["stack-factorybook", "/repo/fb", "bash -lc 'scripts/start.sh'"]]);
  });
});

describe("stopStack", () => {
  it("409 when not running", async () => {
    expect(await stopStack("factorybook", deps({ hasSession: async () => false })))
      .toEqual({ ok: false, error: "not running", code: 409 });
  });
  it("kills the session and returns stopped", async () => {
    const killed: string[] = [];
    const r = await stopStack("factorybook", deps({
      hasSession: async () => true,
      killSession: async (n) => { killed.push(n); },
    }));
    expect(r).toEqual({ ok: true, status: "stopped" });
    expect(killed).toEqual(["stack-factorybook"]);
  });
  it("404 when the project has no start.sh", async () => {
    expect(await stopStack("lime", deps())).toEqual({ ok: false, error: "no stack", code: 404 });
  });
});
