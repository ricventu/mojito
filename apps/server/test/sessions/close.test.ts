import { describe, expect, it, vi } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { killSession } from "../../src/sessions/close";

const meta = (state: SessionMeta["state"]): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
  brainstorming: false,
  state,
  alert: state === "needs-input" ? "claude ti sta aspettando" : null,
  createdAt: 1,
  lastEventAt: 1,
});

function setup(row: SessionMeta | null, closed: boolean) {
  const sessions = new SessionsRepo(openDb(":memory:"));
  if (row) sessions.insert(row);
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const closeSession = vi.fn(async () => ({ closed }));
  const kill = () => killSession("mj-RIC-1", { sessions, bus, closeSession, now: () => 800 });
  return { sessions, events, closeSession, kill };
}

describe("killSession", () => {
  it("404s on an unknown id and closes nothing", async () => {
    const { kill, closeSession, events } = setup(null, true);
    expect(await kill()).toEqual({ status: 404 });
    expect(closeSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("200s on an already-ended row without touching tmux", async () => {
    const { kill, closeSession, events } = setup(meta("ended"), true);
    expect(await kill()).toEqual({ status: 200 });
    expect(closeSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("409s and changes nothing when claude will not leave", async () => {
    const { kill, closeSession, sessions, events } = setup(meta("needs-input"), false);
    expect(await kill()).toEqual({ status: 409 });
    expect(closeSession).toHaveBeenCalledWith("mj-RIC-1");
    expect(sessions.get("mj-RIC-1")).toEqual(meta("needs-input"));
    expect(events).toEqual([]);
  });

  it("ends the row and emits once tmux is closed", async () => {
    const { kill, sessions, events } = setup(meta("needs-input"), true);
    expect(await kill()).toEqual({ status: 200 });
    const row = sessions.get("mj-RIC-1");
    expect(row).toMatchObject({ state: "ended", alert: null, lastEventAt: 800 });
    expect(events).toEqual([{ type: "session.updated", session: row }]);
  });
});
