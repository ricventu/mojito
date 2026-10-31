import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { STALL_GRACE_MS, watchStartupStall } from "../../src/sessions/startupStall";

const meta = (state: SessionMeta["state"]): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
  state,
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  hidden: false,
  title: null,
});

function setup(state: SessionMeta["state"], alive: boolean) {
  const sessions = new SessionsRepo(openDb(":memory:"));
  sessions.insert(meta(state));
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const hasSession = vi.fn(async () => alive);
  watchStartupStall("mj-RIC-1", { sessions, bus, hasSession });
  return { sessions, events, hasSession };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("watchStartupStall", () => {
  it("flips a session still starting with a live tmux to needs-input, with an alert and an event", async () => {
    const { sessions, events, hasSession } = setup("starting", true);
    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS - 1);
    expect(sessions.get("mj-RIC-1")?.state).toBe("starting");
    await vi.advanceTimersByTimeAsync(1);
    expect(hasSession).toHaveBeenCalledWith("mj-RIC-1");
    const row = sessions.get("mj-RIC-1");
    expect(row?.state).toBe("needs-input");
    expect(row?.alert).toBe("open the terminal and answer");
    expect(events).toEqual([{ type: "session.updated", session: row }]);
  });

  it("leaves a session a hook has already spoken for alone", async () => {
    const { sessions, events } = setup("running", true);
    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS);
    expect(sessions.get("mj-RIC-1")?.state).toBe("running");
    expect(events).toEqual([]);
  });

  it("leaves the session alone, without an unhandled rejection, when tmux cannot be asked", async () => {
    const sessions = new SessionsRepo(openDb(":memory:"));
    sessions.insert(meta("starting"));
    const bus = new EventBus();
    const events: MojitoEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    watchStartupStall("mj-RIC-1", { sessions, bus, hasSession: vi.fn(async () => Promise.reject(new Error("tmux hung"))) });
    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS);
    expect(sessions.get("mj-RIC-1")?.state).toBe("starting");
    expect(events).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("leaves a session whose tmux is gone alone", async () => {
    const { sessions, events } = setup("starting", false);
    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS);
    expect(sessions.get("mj-RIC-1")?.state).toBe("starting");
    expect(sessions.get("mj-RIC-1")?.alert).toBeNull();
    expect(events).toEqual([]);
  });

  it("does nothing for a session whose row is gone", async () => {
    const { sessions, events, hasSession } = setup("starting", true);
    sessions.remove("mj-RIC-1");
    await vi.advanceTimersByTimeAsync(STALL_GRACE_MS);
    expect(hasSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("does not hold the process open", () => {
    vi.useRealTimers();
    const unref = vi.fn();
    const fakeTimeout = vi.fn(() => ({ unref })) as unknown as typeof setTimeout;
    const sessions = new SessionsRepo(openDb(":memory:"));
    watchStartupStall("mj-x", { sessions, bus: new EventBus(), hasSession: async () => true, setTimeout: fakeTimeout });
    expect(fakeTimeout).toHaveBeenCalledWith(expect.any(Function), STALL_GRACE_MS);
    expect(unref).toHaveBeenCalled();
  });
});
