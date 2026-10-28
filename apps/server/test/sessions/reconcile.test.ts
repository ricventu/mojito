import { describe, expect, it } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { reconcileSessions } from "../../src/sessions/reconcile";

const meta = (id: string, state: SessionMeta["state"]): SessionMeta => ({
  id,
  kind: "ticket",
  project: "Web",
  ticket: id.slice(3),
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
  brainstorming: false,
  state,
  alert: state === "needs-input" ? "x" : null,
  createdAt: 1,
  lastEventAt: 1,
});

function setup(rows: SessionMeta[], tmux: string[]) {
  const sessions = new SessionsRepo(openDb(":memory:"));
  rows.forEach((r) => sessions.insert(r));
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const run = () => reconcileSessions({ sessions, bus, listTmux: async () => tmux, now: () => 900 });
  return { sessions, events, run };
}

describe("reconcileSessions", () => {
  it("ends rows without tmux and adopts tmux sessions without a row", async () => {
    const { sessions, events, run } = setup([meta("mj-RIC-1", "running"), meta("mj-RIC-2", "idle")], ["mj-RIC-1", "mj-web-aa11bb"]);
    expect(await run()).toEqual({ ended: ["mj-RIC-2"], adopted: ["mj-web-aa11bb"] });
    expect(sessions.get("mj-RIC-1")?.state).toBe("running");
    expect(sessions.get("mj-RIC-2")).toMatchObject({ state: "ended", alert: null, lastEventAt: 900 });
    expect(sessions.get("mj-web-aa11bb")).toEqual({
      id: "mj-web-aa11bb",
      kind: "claude",
      project: null,
      ticket: null,
      cwd: "",
      model: null,
      effort: null,
      brainstorming: false,
      state: "idle",
      alert: null,
      createdAt: 900,
      lastEventAt: 900,
    });
    expect(events).toEqual([
      { type: "session.updated", session: sessions.get("mj-RIC-2") },
      { type: "session.updated", session: sessions.get("mj-web-aa11bb") },
    ]);
  });

  it("clears the alert of a needs-input row that ends", async () => {
    const { sessions, run } = setup([meta("mj-RIC-3", "needs-input")], []);
    await run();
    expect(sessions.get("mj-RIC-3")).toMatchObject({ state: "ended", alert: null });
  });

  it("adopts a ticket tmux with its ticket and kind", async () => {
    const { sessions, run } = setup([], ["mj-RIC-9"]);
    expect((await run()).adopted).toEqual(["mj-RIC-9"]);
    expect(sessions.get("mj-RIC-9")).toMatchObject({ kind: "ticket", ticket: "RIC-9" });
  });

  it("ignores tmux sessions outside the mj- prefix", async () => {
    const { sessions, run } = setup([], ["work", "other-RIC-1"]);
    expect(await run()).toEqual({ ended: [], adopted: [] });
    expect(sessions.list()).toEqual([]);
  });

  it("leaves rows already ended alone, with no event", async () => {
    const { sessions, events, run } = setup([meta("mj-RIC-4", "ended")], []);
    expect(await run()).toEqual({ ended: [], adopted: [] });
    expect(sessions.get("mj-RIC-4")?.lastEventAt).toBe(1);
    expect(events).toEqual([]);
  });

  it("is idempotent", async () => {
    const { run } = setup([meta("mj-RIC-5", "idle")], ["mj-web-aa11bb"]);
    await run();
    expect(await run()).toEqual({ ended: [], adopted: [] });
  });
});
