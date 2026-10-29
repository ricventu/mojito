import { describe, expect, it } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { markEnded, reconcileSessions } from "../../src/sessions/reconcile";

const meta = (id: string, state: SessionMeta["state"]): SessionMeta => ({
  id,
  kind: "ticket",
  project: "Web",
  ticket: id.slice(3),
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
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

describe("markEnded", () => {
  it("ends a live row, clearing its alert, and emits it", () => {
    const { sessions, events } = setup([meta("mj-RIC-7", "needs-input")], []);
    const bus = new EventBus();
    bus.subscribe((e) => events.push(e));
    expect(markEnded("mj-RIC-7", { sessions, bus, now: () => 42 })).toBe(true);
    expect(sessions.get("mj-RIC-7")).toMatchObject({ state: "ended", alert: null, lastEventAt: 42 });
    expect(events).toEqual([{ type: "session.updated", session: sessions.get("mj-RIC-7") }]);
  });

  it("leaves an unknown or already ended row alone", () => {
    const { sessions, events } = setup([meta("mj-RIC-8", "ended")], []);
    const bus = new EventBus();
    bus.subscribe((e) => events.push(e));
    expect(markEnded("mj-RIC-8", { sessions, bus, now: () => 42 })).toBe(false);
    expect(markEnded("mj-NOPE-1", { sessions, bus, now: () => 42 })).toBe(false);
    expect(sessions.get("mj-RIC-8")?.lastEventAt).toBe(1);
    expect(events).toEqual([]);
  });
});

describe("reconcileSessions", () => {
  it("ends rows without tmux and adopts tmux sessions without a row", async () => {
    const { sessions, events, run } = setup([meta("mj-RIC-1", "running"), meta("mj-RIC-2", "idle")], ["mj-RIC-1", "mj-web-aa11bb"]);
    expect(await run()).toEqual({ ended: ["mj-RIC-2"], adopted: ["mj-web-aa11bb"], revived: [] });
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
    expect(await run()).toEqual({ ended: [], adopted: [], revived: [] });
    expect(sessions.list()).toEqual([]);
  });

  it("leaves ended rows whose tmux is gone alone, with no event", async () => {
    const { sessions, events, run } = setup([meta("mj-RIC-4", "ended")], []);
    expect(await run()).toEqual({ ended: [], adopted: [], revived: [] });
    expect(sessions.get("mj-RIC-4")?.lastEventAt).toBe(1);
    expect(events).toEqual([]);
  });

  // tmux is the ground truth: a row a missed or misread hook ended wrongly heals at boot.
  it("revives an ended row whose tmux is alive as idle, and says so", async () => {
    const { sessions, events, run } = setup([meta("mj-RIC-6", "ended")], ["mj-RIC-6"]);
    expect(await run()).toEqual({ ended: [], adopted: [], revived: ["mj-RIC-6"] });
    expect(sessions.get("mj-RIC-6")).toMatchObject({ state: "idle", alert: null, lastEventAt: 900 });
    expect(events).toEqual([{ type: "session.updated", session: sessions.get("mj-RIC-6") }]);
  });

  it("is idempotent", async () => {
    const { run } = setup([meta("mj-RIC-5", "idle")], ["mj-web-aa11bb"]);
    await run();
    expect(await run()).toEqual({ ended: [], adopted: [], revived: [] });
  });
});
