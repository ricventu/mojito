import { describe, it, expect, afterEach } from "vitest";
import { listStacks, resolveStack, startStack, stopStack, pullStack, pushStack, _resetStackInflight, type StackDeps, type PaneInfo } from "@/server/projectStack";
import { FfPullError, type FfPullResult } from "@/server/ffPull";
import { GitPushError, type GitPushResult } from "@/server/gitPush";

const pane = (session: string, cwd: string, dead = false, deadStatus = ""): PaneInfo =>
  ({ session, cwd, dead, deadStatus });

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
// Only Mojito's own checkout has scripts/init-worktree.sh (RIC-240) — see the
// hasWorktreeScript case below.
const PRESENT = new Set(["/repo/mojito/scripts/init-worktree.sh"]);

function deps(over: Partial<StackDeps> = {}): StackDeps {
  return {
    projectsPath: "/ignored",
    selfPath: SELF,
    loadMap: () => MAP as never,
    isExecutable: (p) => EXECUTABLE.has(p),
    exists: (p) => PRESENT.has(p),
    listPanes: async () => [],
    startSession: async () => {},
    stopSession: async () => {},
    ...over,
  };
}

afterEach(() => _resetStackInflight());

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

  // The toolbar offers "Create worktree script" on exactly the repos a ticket launch
  // would warn about, so the flag tests existence — the same check createTicketWorktree
  // makes — not the +x bit.
  it("reports whether each repo already has scripts/init-worktree.sh", async () => {
    const rows = await listStacks(deps());
    const has = Object.fromEntries(rows.map((r) => [r.project, r.hasWorktreeScript]));
    expect(has).toEqual({
      Factorybook: false, "Gestionale Cooperative": false, Lime: false, Mojito: true,
    });
  });

  // The client builds the toolbar's Warp / VS Code links from it (see projectLinks), so
  // it has to be the mapped root verbatim rather than a slug or a derived path.
  it("carries each project's mapped repo root", async () => {
    const rows = await listStacks(deps());
    expect(Object.fromEntries(rows.map((r) => [r.project, r.path]))).toEqual({
      Factorybook: "/repo/fb",
      "Gestionale Cooperative": "/repo/gc",
      Lime: "/repo/lime",
      Mojito: "/repo/mojito",
    });
  });

  it("flags the Mojito self-row (path === selfPath) as not pullable", async () => {
    const rows = await listStacks(deps());
    const mojito = rows.find((r) => r.project === "Mojito")!;
    expect(mojito.pullable).toBe(false);
    expect(mojito.self).toBe(true);
    const fb = rows.find((r) => r.project === "Factorybook")!;
    expect(fb.self).toBe(false);
  });

  it("derives status from the stack's own child session (found by path)", async () => {
    const running = await listStacks(deps({
      listPanes: async () => [pane("fb-dev", "/repo/fb/backend"), pane("fb-dev", "/repo/fb/webapp")],
    }));
    expect(running.find((r) => r.project === "Factorybook")!.status).toBe("running");

    // A dead sibling pane (one dev server exited) still counts as running: the
    // stack is up as long as any pane lives.
    const partial = await listStacks(deps({
      listPanes: async () => [pane("fb-dev", "/repo/fb/backend"), pane("fb-dev", "", true, "1")],
    }));
    expect(partial.find((r) => r.project === "Factorybook")!.status).toBe("running");

    const stopped = await listStacks(deps({ listPanes: async () => [] }));
    expect(stopped.find((r) => r.project === "Factorybook")!.status).toBe("stopped");
  });

  it("ignores panes outside the project root and Mojito's own sessions", async () => {
    const rows = await listStacks(deps({
      listPanes: async () => [
        pane("keeper", "/home/mojito"), // outside root
        pane("mojito-RIC-1-to-code", "/repo/fb/wt"), // lime session in-tree -> excluded
      ],
    }));
    expect(rows.find((r) => r.project === "Factorybook")!.status).toBe("stopped");
  });

  it("falls back to the launcher pane when no child session exists yet", async () => {
    const booting = await listStacks(deps({ listPanes: async () => [pane("stack-factorybook", "/repo/fb")] }));
    expect(booting.find((r) => r.project === "Factorybook")!.status).toBe("running");

    const failed = await listStacks(deps({ listPanes: async () => [pane("stack-factorybook", "", true, "1")] }));
    expect(failed.find((r) => r.project === "Factorybook")!.status).toBe("crashed");

    // start.sh detached and exited 0, but the stack is no longer up -> stopped.
    const exited = await listStacks(deps({ listPanes: async () => [pane("stack-factorybook", "", true, "0")] }));
    expect(exited.find((r) => r.project === "Factorybook")!.status).toBe("stopped");
  });

  it("leaves status null for projects without start.sh", async () => {
    const rows = await listStacks(deps({ listPanes: async () => [pane("lime-dev", "/repo/lime")] }));
    expect(rows.find((r) => r.project === "Lime")!.status).toBeNull();
  });
});

describe("resolveStack", () => {
  it("finds a project by slug and reports hasStack + pullable", () => {
    expect(resolveStack("factorybook", deps())).toEqual({
      project: "Factorybook", path: "/repo/fb", hasStack: true, pullable: true, self: false,
    });
    expect(resolveStack("mojito", deps())).toMatchObject({ pullable: false, self: true });
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
    const r = await startStack("factorybook", deps({
      listPanes: async () => [pane("fb-dev", "/repo/fb/backend")],
    }));
    expect(r).toEqual({ ok: false, error: "already running", code: 409 });
  });
  it("starts the stack and returns running", async () => {
    const calls: Array<[string, string, string]> = [];
    const r = await startStack("factorybook", deps({
      listPanes: async () => [],
      startSession: async (n, c, cmd) => { calls.push([n, c, cmd]); },
    }));
    expect(r).toEqual({ ok: true, status: "running" });
    expect(calls).toEqual([["stack-factorybook", "/repo/fb", "bash -lc 'scripts/start.sh'"]]);
  });
  it("clears a stale launcher pane before starting", async () => {
    const stopped: string[] = [];
    const started: string[] = [];
    const r = await startStack("factorybook", deps({
      listPanes: async () => [pane("stack-factorybook", "", true, "0")], // stale, exited -> stopped
      stopSession: async (n) => { stopped.push(n); },
      startSession: async (n) => { started.push(n); },
    }));
    expect(r).toEqual({ ok: true, status: "running" });
    expect(stopped).toEqual(["stack-factorybook"]);
    expect(started).toEqual(["stack-factorybook"]);
  });
});

describe("stopStack", () => {
  it("409 when nothing is running (no child session, no launcher)", async () => {
    expect(await stopStack("factorybook", deps({ listPanes: async () => [] })))
      .toEqual({ ok: false, error: "not running", code: 409 });
  });
  it("stops the child session(s) and launcher cleanly, returns stopped", async () => {
    const stopped: string[] = [];
    const r = await stopStack("factorybook", deps({
      listPanes: async () => [
        pane("fb-dev", "/repo/fb/backend"),
        pane("fb-dev", "/repo/fb/webapp"),
        pane("stack-factorybook", "", true, "0"),
      ],
      stopSession: async (n) => { stopped.push(n); },
    }));
    expect(r).toEqual({ ok: true, status: "stopped" });
    expect(stopped).toEqual(["fb-dev", "stack-factorybook"]);
  });
  it("404 when the project has no start.sh", async () => {
    expect(await stopStack("lime", deps())).toEqual({ ok: false, error: "no stack", code: 404 });
  });
});

describe("pullStack", () => {
  it("404 when the row is not pullable (Mojito self-row)", async () => {
    expect(await pullStack("mojito", deps())).toEqual({ ok: false, error: "not pullable", code: 404 });
  });
  it("404 for an unknown slug", async () => {
    expect(await pullStack("nope", deps())).toEqual({ ok: false, error: "not pullable", code: 404 });
  });
  it("returns the FfPullResult on success", async () => {
    const result: FfPullResult = { status: "updated", from: "aaa", to: "bbb" };
    expect(await pullStack("factorybook", deps({ pull: async () => result })))
      .toEqual({ ok: true, result });
  });
  it("maps diverged -> 409 and failed -> 500 with detail", async () => {
    const diverged = await pullStack("factorybook", deps({
      pull: async () => { throw new FfPullError("diverged", "Not possible to fast-forward"); },
    }));
    expect(diverged).toEqual({ ok: false, error: "diverged", code: 409, detail: "Not possible to fast-forward" });
    const failed = await pullStack("fb2-unused", deps({
      loadMap: () => ({ RIC: { projects: { Factorybook: "/repo/fb" } } }) as never,
      pull: async () => { throw new FfPullError("failed", "network down"); },
    }));
    // (slug "factorybook" is single-flighted; use the same slug after reset)
    _resetStackInflight();
    const failed2 = await pullStack("factorybook", deps({
      pull: async () => { throw new FfPullError("failed", "network down"); },
    }));
    expect(failed2).toEqual({ ok: false, error: "failed", code: 500, detail: "network down" });
  });
  it("single-flights concurrent pulls for the same slug", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps({ pull: async () => { calls += 1; await gate; return { status: "up-to-date", from: "x", to: "x" }; } });
    const p1 = pullStack("factorybook", d);
    const p2 = pullStack("factorybook", d);
    release();
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
});

describe("pushStack", () => {
  const pushed: GitPushResult = { status: "pushed", branch: "main", from: "aaa", to: "bbb" };

  it("404 for an unknown slug", async () => {
    expect(await pushStack("nope", deps())).toEqual({ ok: false, error: "unknown stack", code: 404 });
  });

  it("returns the push result for a mapped project", async () => {
    expect(await pushStack("factorybook", deps({ push: async () => pushed })))
      .toEqual({ ok: true, result: pushed });
  });

  it("pushes the Mojito self-row, unlike pull", async () => {
    const seen: string[] = [];
    const res = await pushStack("mojito", deps({ push: async (cwd) => { seen.push(cwd); return pushed; } }));
    expect(res).toEqual({ ok: true, result: pushed });
    expect(seen).toEqual([SELF]);
  });

  it("maps rejected to 409 and every other kind to 500", async () => {
    const rejected = await pushStack("factorybook", deps({
      push: async () => { throw new GitPushError("rejected", "! [rejected] main -> main"); },
    }));
    expect(rejected).toMatchObject({ ok: false, error: "rejected", code: 409 });
    _resetStackInflight();
    const detached = await pushStack("factorybook", deps({
      push: async () => { throw new GitPushError("detached", "repo is on a detached HEAD"); },
    }));
    expect(detached).toMatchObject({ ok: false, error: "detached", code: 500 });
    _resetStackInflight();
    const failed = await pushStack("factorybook", deps({
      push: async () => { throw new GitPushError("failed", "could not read Username"); },
    }));
    expect(failed).toMatchObject({ ok: false, error: "failed", code: 500, detail: "could not read Username" });
  });

  it("single-flights concurrent pushes for the same slug", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps({ push: async () => { calls += 1; await gate; return pushed; } });
    const p1 = pushStack("factorybook", d);
    const p2 = pushStack("factorybook", d);
    release();
    expect(await p1).toEqual({ ok: true, result: pushed });
    expect(await p2).toEqual({ ok: true, result: pushed });
    expect(calls).toBe(1);
  });
});
