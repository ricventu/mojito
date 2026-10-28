import { describe, expect, it, vi } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import type { TicketCache } from "../../src/tickets/cache";
import { handleHook, kindFromId } from "../../src/sessions/hooks";

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
  brainstorming: false,
  state: "running",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  ...over,
});

function setup(row?: SessionMeta) {
  const sessions = new SessionsRepo(openDb(":memory:"));
  if (row) sessions.insert(row);
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const refresh = vi.fn(() => Promise.resolve());
  const tickets = { refresh } as unknown as TicketCache;
  const deps = { sessions, bus, tickets, now: () => 500 };
  return { sessions, events, refresh, deps };
}

describe("kindFromId", () => {
  it("reads a ticket id off the name", () => {
    expect(kindFromId("mj-RIC-12")).toBe("ticket");
    expect(kindFromId("mj-AB2-7")).toBe("ticket");
  });
  it("calls anything else claude", () => {
    expect(kindFromId("mj-web-ab12cd")).toBe("claude");
    expect(kindFromId("mj-general-ab12cd")).toBe("claude");
    expect(kindFromId("mj-RIC-12-extra")).toBe("claude");
    expect(kindFromId("mj-ric-12")).toBe("claude");
  });
});

describe("handleHook", () => {
  it("ignores an unknown id without throwing or emitting", () => {
    const { events, refresh, deps } = setup();
    expect(() => handleHook("mj-x", "Stop", deps)).not.toThrow();
    expect(events).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores an unknown event", () => {
    const { sessions, events, deps } = setup(meta());
    handleHook("mj-RIC-1", "Bogus", deps);
    expect(sessions.get("mj-RIC-1")).toEqual(meta());
    expect(events).toEqual([]);
  });

  it("patches state, alert and lastEventAt and emits the patched row", () => {
    const { sessions, events, deps } = setup(meta());
    handleHook("mj-RIC-1", "PermissionRequest", deps);
    const row = sessions.get("mj-RIC-1");
    expect(row).toMatchObject({ state: "needs-input", alert: "claude chiede un permesso", lastEventAt: 500 });
    expect(events).toEqual([{ type: "session.updated", session: row }]);
  });

  it("clears the alert when the session resumes", () => {
    const { sessions, deps } = setup(meta({ state: "needs-input", alert: "claude ti sta aspettando" }));
    handleHook("mj-RIC-1", "PostToolUse", deps);
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "running", alert: null });
  });

  it("refreshes lastEventAt without emitting when nothing visible changed", () => {
    const { sessions, events, deps } = setup(meta());
    handleHook("mj-RIC-1", "PostToolUse", deps);
    expect(sessions.get("mj-RIC-1")?.lastEventAt).toBe(500);
    expect(events).toEqual([]);
  });

  it("never revives an ended session", () => {
    const { sessions, events, deps } = setup(meta({ state: "ended", lastEventAt: 7 }));
    handleHook("mj-RIC-1", "SessionStart", deps);
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "ended", lastEventAt: 7 });
    expect(events).toEqual([]);
  });

  it("refreshes the board when a ticket session stops", () => {
    const { sessions, refresh, deps } = setup(meta());
    handleHook("mj-RIC-1", "Stop", deps);
    expect(sessions.get("mj-RIC-1")?.state).toBe("idle");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for a non-ticket session or a non-Stop event", () => {
    const free = setup(meta({ id: "mj-web-aa11bb", kind: "claude", ticket: null }));
    handleHook("mj-web-aa11bb", "Stop", free.deps);
    expect(free.refresh).not.toHaveBeenCalled();
    const ticket = setup(meta());
    handleHook("mj-RIC-1", "Notification", ticket.deps);
    expect(ticket.refresh).not.toHaveBeenCalled();
  });

  it("swallows a failure instead of throwing", () => {
    const { deps } = setup(meta());
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.sessions.get = () => {
      throw new Error("db closed");
    };
    expect(() => handleHook("mj-RIC-1", "Stop", deps)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
