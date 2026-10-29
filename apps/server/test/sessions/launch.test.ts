import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROMPTS, type LaunchFreeBody, type LaunchTicketBody, type MojitoEvent, type SessionMeta, type TicketSummary } from "@mojito/shared";
import type { ServerConfig } from "../../src/config";
import { openDb } from "../../src/db/db";
import { ProjectsRepo } from "../../src/db/projects";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { DuplicateSessionError, q } from "../../src/tmux/tmux";
import { buildHookSettings } from "../../src/sessions/hookSettings";
import { buildTicketPrompt } from "../../src/sessions/prompt";
import { STALL_GRACE_MS } from "../../src/sessions/startupStall";
import { launchFree, launchTicket, type LaunchDeps } from "../../src/sessions/launch";

const cfg: ServerConfig = {
  port: 3100,
  host: "0.0.0.0",
  token: "tok",
  linearApiKey: "key",
  stateDir: "/state",
  repoRoot: "/mojito",
  projectsJsonPath: "/cfg/projects.json",
  home: "/home/me",
};

const ticket = (identifier: string, project: string | null): TicketSummary => ({
  identifier,
  title: "t",
  url: `https://linear.app/x/issue/${identifier}`,
  statusName: "Todo",
  statusType: "unstarted",
  project,
  labels: [],
  assignedToMe: false,
});

function setup(over: Partial<LaunchDeps> = {}, opts: { stateDir?: string } = {}) {
  const db = openDb(":memory:");
  const sessions = new SessionsRepo(db);
  const projects = new ProjectsRepo(db);
  projects.upsert({ name: "Web", path: "/repo/web", teamKey: "RIC" });
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const cached = [ticket("RIC-1", "Web"), ticket("RIC-2", "Unmapped"), ticket("RIC-3", null)];
  const tickets = {
    get: vi.fn((id: string) => cached.find((t) => t.identifier === id) ?? null),
    refresh: vi.fn(async () => {}),
  };
  const linear = { setStatus: vi.fn(async () => {}), assignToMe: vi.fn(async () => {}) };
  const files = new Map<string, string>();
  const deps: LaunchDeps = {
    cfg: { ...cfg, stateDir: opts.stateDir ?? cfg.stateDir },
    sessions,
    projects,
    bus,
    linear,
    tickets,
    newSession: vi.fn(async () => {}),
    hasSession: vi.fn(async () => true),
    exists: vi.fn(() => true),
    writeFile: vi.fn((path: string, data: string) => void files.set(path, data)),
    now: () => 1000,
    randomHex: () => "a1b2c3",
    prompts: () => DEFAULT_PROMPTS,
    ...over,
  };
  return { deps, sessions, projects, events, tickets, linear, files };
}

const body = (over: Partial<LaunchTicketBody> = {}): LaunchTicketBody => ({
  kind: "ticket",
  ticket: "RIC-1",
  model: "opus",
  effort: "high",
  ...over,
});

const row = (over: Partial<SessionMeta>): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/repo/web",
  model: "sonnet",
  effort: "low",
  state: "running",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  hidden: false,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("launchTicket", () => {
  it("spawns claude in the project, records a starting row and writes Linear", async () => {
    const { deps, sessions, events, tickets, linear, files } = setup();
    const res = await launchTicket(body(), deps);

    const settingsPath = "/state/hooks/mj-RIC-1.json";
    const expected: SessionMeta = {
      id: "mj-RIC-1",
      kind: "ticket",
      project: "Web",
      ticket: "RIC-1",
      cwd: "/repo/web",
      model: "opus",
      effort: "high",
      state: "starting",
      alert: null,
      createdAt: 1000,
      lastEventAt: 1000,
      hidden: false,
    };
    expect(res).toEqual({ ok: true, session: expected });
    expect(deps.newSession).toHaveBeenCalledTimes(1);
    expect(deps.newSession).toHaveBeenCalledWith(
      "mj-RIC-1",
      "/repo/web",
      `claude --model 'opus' --effort 'high' --settings '${settingsPath}' ${q(buildTicketPrompt("RIC-1"))}`,
    );
    expect(JSON.parse(files.get(settingsPath)!)).toEqual(buildHookSettings("mj-RIC-1", "http://127.0.0.1:3100", "tok"));
    expect(sessions.get("mj-RIC-1")).toEqual(expected);
    expect(events).toEqual([{ type: "session.updated", session: expected }]);
    expect(linear.setStatus).toHaveBeenCalledWith("RIC-1", "In Progress");
    expect(linear.assignToMe).toHaveBeenCalledWith("RIC-1");
    expect(tickets.refresh).toHaveBeenCalled();
  });

  it("writes Linear only after the session exists", async () => {
    const order: string[] = [];
    const { deps } = setup({
      newSession: vi.fn(async () => void order.push("newSession")),
      linear: {
        setStatus: vi.fn(async () => void order.push("setStatus")),
        assignToMe: vi.fn(async () => void order.push("assignToMe")),
      },
    });
    await launchTicket(body(), deps);
    expect(order).toEqual(["newSession", "setStatus", "assignToMe"]);
  });

  it("passes the model, effort and ticket prompt to claude", async () => {
    const { deps } = setup();
    await launchTicket(body({ model: "sonnet", effort: "max" }), deps);
    const cmd = vi.mocked(deps.newSession).mock.calls[0][2];
    expect(cmd).toBe(
      `claude --model 'sonnet' --effort 'max' --settings '/state/hooks/mj-RIC-1.json' ${q(buildTicketPrompt("RIC-1"))}`,
    );
  });

  it("uses the ticket prompt from the settings as they are at launch", async () => {
    const { deps } = setup({ prompts: () => ({ ...DEFAULT_PROMPTS, ticket: "Work on {ticket}, it's urgent." }) });
    await launchTicket(body(), deps);
    const cmd = vi.mocked(deps.newSession).mock.calls[0][2];
    expect(cmd).toBe(`claude --model 'opus' --effort 'high' --settings '/state/hooks/mj-RIC-1.json' ${q("Work on RIC-1, it's urgent.")}`);
  });

  it("quotes an apostrophe in the settings path", async () => {
    const { deps } = setup({}, { stateDir: "/home/o'neil/state" });
    await launchTicket(body(), deps);
    const cmd = vi.mocked(deps.newSession).mock.calls[0][2];
    expect(cmd).toContain("--settings '/home/o'\\''neil/state/hooks/mj-RIC-1.json'");
  });

  it("still launches when Linear fails, with a warning", async () => {
    const { deps, sessions } = setup({
      linear: { setStatus: vi.fn(async () => { throw new Error("boom"); }), assignToMe: vi.fn(async () => {}) },
    });
    const res = await launchTicket(body(), deps);
    expect(res).toMatchObject({ ok: true, warning: "Linear status not updated: boom" });
    expect(deps.linear.assignToMe).toHaveBeenCalledWith("RIC-1");
    expect(sessions.get("mj-RIC-1")?.state).toBe("starting");
  });

  it("does not fail the launch on a refresh that rejects", async () => {
    const { deps } = setup();
    vi.mocked(deps.tickets.refresh).mockRejectedValueOnce(new Error("down"));
    const res = await launchTicket(body(), deps);
    expect(res.ok).toBe(true);
  });

  it("rejects an invalid ticket id before building any command", async () => {
    const { deps } = setup();
    const res = await launchTicket(body({ ticket: "RIC-1'; rm -rf ~" }), deps);
    expect(res).toEqual({ ok: false, status: 400, error: "invalid ticket id: RIC-1'; rm -rf ~" });
    expect(deps.newSession).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("answers 404 for a ticket the cache does not know", async () => {
    const { deps } = setup();
    expect(await launchTicket(body({ ticket: "RIC-9" }), deps)).toEqual({ ok: false, status: 404, error: "ticket not found: RIC-9" });
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a ticket whose project is not mapped", async () => {
    const { deps } = setup();
    expect(await launchTicket(body({ ticket: "RIC-2" }), deps)).toEqual({ ok: false, status: 400, error: "project not mapped: Unmapped" });
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a ticket with no project", async () => {
    const { deps } = setup();
    expect(await launchTicket(body({ ticket: "RIC-3" }), deps)).toEqual({ ok: false, status: 400, error: "ticket has no project: RIC-3" });
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a relative project path even when it resolves locally", async () => {
    const { deps, projects } = setup();
    projects.upsert({ name: "Web", path: "repo/web", teamKey: "RIC" });
    expect(await launchTicket(body(), deps)).toEqual({ ok: false, status: 400, error: "project path not found: repo/web" });
    expect(deps.newSession).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it("launches in a project path under the home directory, recording it expanded", async () => {
    const { deps, projects } = setup();
    projects.upsert({ name: "Web", path: "~/repo/web", teamKey: "RIC" });
    const res = await launchTicket(body(), deps);
    expect(res).toMatchObject({ ok: true, session: { cwd: "/home/me/repo/web" } });
    expect(deps.exists).toHaveBeenCalledWith("/home/me/repo/web");
    expect(vi.mocked(deps.newSession).mock.calls[0][1]).toBe("/home/me/repo/web");
  });

  it("answers 400 for a project path that does not exist, and opens no tmux", async () => {
    const { deps, sessions, linear } = setup({ exists: vi.fn(() => false) });
    expect(await launchTicket(body(), deps)).toEqual({ ok: false, status: 400, error: "project path not found: /repo/web" });
    expect(deps.exists).toHaveBeenCalledWith("/repo/web");
    expect(deps.newSession).not.toHaveBeenCalled();
    expect(sessions.get("mj-RIC-1")).toBeNull();
    expect(linear.setStatus).not.toHaveBeenCalled();
  });

  it("answers 409 with the session id when the ticket already has a live session", async () => {
    const { deps, sessions } = setup();
    sessions.insert(row({ state: "running" }));
    expect(await launchTicket(body(), deps)).toEqual({
      ok: false,
      status: 409,
      error: "session already exists: mj-RIC-1",
      sessionId: "mj-RIC-1",
    });
    expect(deps.hasSession).toHaveBeenCalledWith("mj-RIC-1");
    expect(deps.newSession).not.toHaveBeenCalled();
    expect(sessions.get("mj-RIC-1")?.model).toBe("sonnet");
  });

  it("ends a live row whose tmux is gone and launches", async () => {
    const { deps, sessions, events } = setup({ hasSession: vi.fn(async () => false) });
    sessions.insert(row({ state: "idle" }));
    const res = await launchTicket(body(), deps);
    expect(res.ok).toBe(true);
    expect(events[0]).toEqual({ type: "session.updated", session: row({ state: "ended" }) });
    expect(deps.newSession).toHaveBeenCalledTimes(1);
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "starting", model: "opus", createdAt: 1000 });
  });

  it("answers 409 when tmux reports the name taken, and inserts no row", async () => {
    const { deps, sessions, linear, events } = setup({
      newSession: vi.fn(async (name: string) => { throw new DuplicateSessionError(name); }),
    });
    expect(await launchTicket(body(), deps)).toEqual({
      ok: false,
      status: 409,
      error: "session already exists: mj-RIC-1",
      sessionId: "mj-RIC-1",
    });
    expect(sessions.get("mj-RIC-1")).toBeNull();
    expect(events).toEqual([]);
    expect(linear.setStatus).not.toHaveBeenCalled();
  });

  it("propagates any other tmux failure and releases the lock", async () => {
    const newSession = vi.fn().mockRejectedValueOnce(new Error("no server")).mockResolvedValue(undefined);
    const { deps, sessions } = setup({ newSession });
    await expect(launchTicket(body(), deps)).rejects.toThrow("no server");
    expect(sessions.get("mj-RIC-1")).toBeNull();
    expect((await launchTicket(body(), deps)).ok).toBe(true);
  });

  it("lets exactly one of two concurrent launches through", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { deps, sessions } = setup({ newSession: vi.fn(() => gate) });
    const a = launchTicket(body(), deps);
    const b = launchTicket(body(), deps);
    release();
    const results = await Promise.all([a, b]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, status: 409, error: "session already exists: mj-RIC-1", sessionId: "mj-RIC-1" },
    ]);
    expect(deps.newSession).toHaveBeenCalledTimes(1);
    expect(sessions.list()).toHaveLength(1);
  });

  it("replaces an ended row for the same id", async () => {
    const { deps, sessions } = setup();
    sessions.insert(row({ state: "ended" }));
    const res = await launchTicket(body(), deps);
    expect(res.ok).toBe(true);
    expect(deps.hasSession).not.toHaveBeenCalled();
    expect(sessions.list()).toHaveLength(1);
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "starting", model: "opus", effort: "high", createdAt: 1000 });
  });

  it("a relaunch shows a hidden session again", async () => {
    const { deps, sessions } = setup();
    sessions.insert(row({ state: "ended", hidden: true }));
    const res = await launchTicket(body(), deps);
    expect(res.ok).toBe(true);
    expect(sessions.get("mj-RIC-1")?.hidden).toBe(false);
  });

  it("arms the startup stall watch", async () => {
    const { deps, sessions } = setup();
    await launchTicket(body(), deps);
    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS);
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "needs-input", alert: "open the terminal and answer" });
  });
});

describe("launchFree", () => {
  const free = (over: Partial<LaunchFreeBody>): LaunchFreeBody =>
    ({ kind: "claude", project: "Web", model: "opus", effort: "high", ...over }) as LaunchFreeBody;

  it("opens a claude session in a project without a prompt", async () => {
    const { deps, sessions, events, files, linear } = setup();
    const res = await launchFree(free({}), deps);
    const expected: SessionMeta = {
      id: "mj-web-a1b2c3",
      kind: "claude",
      project: "Web",
      ticket: null,
      cwd: "/repo/web",
      model: "opus",
      effort: "high",
      state: "starting",
      alert: null,
      createdAt: 1000,
      lastEventAt: 1000,
      hidden: false,
    };
    expect(res).toEqual({ ok: true, session: expected });
    const settingsPath = "/state/hooks/mj-web-a1b2c3.json";
    expect(deps.newSession).toHaveBeenCalledWith(
      "mj-web-a1b2c3",
      "/repo/web",
      `claude --model 'opus' --effort 'high' --settings '${settingsPath}'`,
    );
    expect(JSON.parse(files.get(settingsPath)!)).toEqual(buildHookSettings("mj-web-a1b2c3", "http://127.0.0.1:3100", "tok"));
    expect(sessions.get("mj-web-a1b2c3")).toEqual(expected);
    expect(events).toEqual([{ type: "session.updated", session: expected }]);
    expect(linear.setStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS);
    expect(sessions.get("mj-web-a1b2c3")?.state).toBe("needs-input");
  });

  it("slugs the project name", async () => {
    const { deps, projects } = setup();
    projects.upsert({ name: "My App.v2", path: "/repo/app", teamKey: "RIC" });
    const res = await launchFree(free({ project: "My App.v2" }), deps);
    expect(res).toMatchObject({ ok: true, session: { id: "mj-my-app-v2-a1b2c3", cwd: "/repo/app" } });
  });

  it("opens in a project path under the home directory", async () => {
    const { deps, projects } = setup();
    projects.upsert({ name: "Home", path: "~/repo/home", teamKey: "RIC" });
    const res = await launchFree(free({ kind: "shell", project: "Home" }), deps);
    expect(res).toMatchObject({ ok: true, session: { cwd: "/home/me/repo/home" } });
    expect(vi.mocked(deps.newSession).mock.calls[0][1]).toBe("/home/me/repo/home");
  });

  it("opens a General session in the home directory", async () => {
    const { deps } = setup();
    const res = await launchFree(free({ project: null }), deps);
    expect(res).toMatchObject({ ok: true, session: { id: "mj-general-a1b2c3", project: null, cwd: "/home/me" } });
    expect(vi.mocked(deps.newSession).mock.calls[0][1]).toBe("/home/me");
  });

  it("opens a shell running from the start, with no hooks and no stall watch", async () => {
    const { deps, sessions } = setup();
    const res = await launchFree(free({ kind: "shell" }), deps);
    expect(res).toMatchObject({ ok: true, session: { kind: "shell", state: "running", model: null, effort: null } });
    expect(deps.newSession).toHaveBeenCalledWith("mj-web-a1b2c3", "/repo/web", 'exec "${SHELL:-/bin/bash}" -l');
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(sessions.get("mj-web-a1b2c3")?.state).toBe("running");
  });

  it("answers 400 for an unmapped project", async () => {
    const { deps } = setup();
    expect(await launchFree(free({ project: "Nope" }), deps)).toEqual({ ok: false, status: 400, error: "project not mapped: Nope" });
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a directory that does not exist", async () => {
    const { deps } = setup({ exists: vi.fn(() => false) });
    expect(await launchFree(free({ project: null }), deps)).toEqual({ ok: false, status: 400, error: "project path not found: /home/me" });
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a relative project path even when it resolves locally", async () => {
    const { deps, projects } = setup();
    projects.upsert({ name: "Rel", path: "./rel", teamKey: "RIC" });
    for (const kind of ["claude", "shell"] as const) {
      expect(await launchFree(free({ kind, project: "Rel" }), deps)).toEqual({ ok: false, status: 400, error: "project path not found: ./rel" });
    }
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 400 for a claude session without model or effort", async () => {
    const { deps } = setup();
    const res = await launchFree({ kind: "claude", project: null } as LaunchFreeBody, deps);
    expect(res).toEqual({ ok: false, status: 400, error: "model and effort are required for a claude session" });
    expect(deps.newSession).not.toHaveBeenCalled();
  });

  it("answers 409 when tmux reports the name taken", async () => {
    const { deps, sessions } = setup({ newSession: vi.fn(async (n: string) => { throw new DuplicateSessionError(n); }) });
    expect(await launchFree(free({}), deps)).toEqual({
      ok: false,
      status: 409,
      error: "session already exists: mj-web-a1b2c3",
      sessionId: "mj-web-a1b2c3",
    });
    expect(sessions.list()).toEqual([]);
  });
});
