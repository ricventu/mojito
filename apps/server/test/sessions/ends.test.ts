import { describe, expect, it, vi } from "vitest";
import type { MojitoEvent, SessionMeta } from "@mojito/shared";
import { openDb } from "../../src/db/db";
import { SessionsRepo } from "../../src/db/sessions";
import { EventBus } from "../../src/events/bus";
import { EndWatch, OOM_WINDOW_MS } from "../../src/sessions/ends";
import type { LivePane } from "../../src/tmux/tmux";

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "mj-RIC-1",
  kind: "ticket",
  project: "Web",
  ticket: "RIC-1",
  cwd: "/repo/web",
  model: "opus",
  effort: "high",
  state: "running",
  alert: null,
  createdAt: 1,
  lastEventAt: 1,
  title: null,
  endReason: null,
  claudeSessionId: null,
  ...over,
});

const panes = (entries: Record<string, number | null>) =>
  new Map<string, LivePane>(Object.entries(entries).map(([id, pid]) => [id, { title: "✳ x", pid }]));

function setup(rows: SessionMeta[], oom = false) {
  const sessions = new SessionsRepo(openDb(":memory:"));
  for (const r of rows) sessions.insert(r);
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const lines: string[] = [];
  const pending: Array<() => void> = [];
  const paneScope = vi.fn((pid: number) => `tmux-spawn-${pid}.scope`);
  const oomKilledSince = vi.fn(async () => oom);
  const watch = new EndWatch({
    sessions,
    bus,
    now: () => 1000,
    paneScope,
    oomKilledSince,
    log: (l) => lines.push(l),
    schedule: (fn) => void pending.push(fn),
  });
  const flush = async () => {
    for (const fn of pending.splice(0)) fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sessions, bus, events, lines, paneScope, oomKilledSince, watch, flush };
}

describe("EndWatch.observe", () => {
  it("ends a live row whose tmux is no longer listed, as gone", () => {
    const { sessions, events, lines, watch } = setup([meta(), meta({ id: "mj-RIC-2" })]);
    watch.observe(panes({ "mj-RIC-2": 7 }), sessions.list());
    expect(sessions.get("mj-RIC-1")).toMatchObject({ state: "ended", endReason: "gone", lastEventAt: 1000 });
    expect(sessions.get("mj-RIC-2")?.state).toBe("running");
    expect(events).toHaveLength(1);
    expect(lines).toEqual(["session mj-RIC-1 ended: gone"]);
  });

  it("leaves a row launched while tmux answered, and one ended or relaunched meanwhile", () => {
    const { sessions, watch } = setup([meta({ id: "mj-RIC-2", createdAt: 1 })]);
    const before = sessions.list();
    sessions.insert(meta({ id: "mj-RIC-1", createdAt: 5 })); // launched after the snapshot
    sessions.insert(meta({ id: "mj-RIC-2", createdAt: 9 })); // relaunched under the same id
    watch.observe(panes({}), before);
    expect(sessions.get("mj-RIC-1")?.state).toBe("running");
    expect(sessions.get("mj-RIC-2")?.state).toBe("running");
  });

  it("reads each pane's scope once per process", () => {
    const { sessions, paneScope, watch } = setup([meta()]);
    watch.observe(panes({ "mj-RIC-1": 7 }), sessions.list());
    watch.observe(panes({ "mj-RIC-1": 7 }), sessions.list());
    watch.observe(panes({ "mj-RIC-1": 8 }), sessions.list());
    expect(paneScope.mock.calls).toEqual([[7], [8]]);
  });
});

describe("EndWatch OOM", () => {
  it("turns an involuntary end into oom when the pane's scope logged an OOM kill", async () => {
    const { sessions, bus, lines, oomKilledSince, watch, flush } = setup([meta()], true);
    watch.observe(panes({ "mj-RIC-1": 7 }), sessions.list());
    // What handleHook does for the SessionEnd of a SIGTERM'd claude.
    const ended = sessions.patch("mj-RIC-1", { state: "ended", endReason: "other", lastEventAt: 500_000 })!;
    bus.emit({ type: "session.updated", session: ended });
    await flush();
    expect(oomKilledSince).toHaveBeenCalledWith("tmux-spawn-7.scope", 500_000 - OOM_WINDOW_MS);
    expect(sessions.get("mj-RIC-1")?.endReason).toBe("oom");
    expect(lines).toEqual(["session mj-RIC-1 ended: other", "session mj-RIC-1 ended: oom"]);
  });

  it("never second-guesses a Kill or an /exit, nor a pane it never saw", async () => {
    const { sessions, bus, oomKilledSince, watch, flush } = setup([meta(), meta({ id: "mj-RIC-2" })], true);
    watch.observe(panes({ "mj-RIC-1": 7, "mj-RIC-2": 8 }), sessions.list());
    bus.emit({ type: "session.updated", session: sessions.patch("mj-RIC-1", { state: "ended", endReason: "killed" })! });
    bus.emit({ type: "session.updated", session: sessions.patch("mj-RIC-2", { state: "ended", endReason: "exited" })! });
    bus.emit({ type: "session.updated", session: meta({ id: "mj-unseen", state: "ended", endReason: "gone" }) });
    await flush();
    expect(oomKilledSince).not.toHaveBeenCalled();
    expect(sessions.get("mj-RIC-1")?.endReason).toBe("killed");
  });

  it("keeps the reason when the journal has no OOM kill, or the row was relaunched meanwhile", async () => {
    const quiet = setup([meta()], false);
    quiet.watch.observe(panes({ "mj-RIC-1": 7 }), quiet.sessions.list());
    quiet.watch.observe(panes({}), quiet.sessions.list());
    await quiet.flush();
    expect(quiet.sessions.get("mj-RIC-1")?.endReason).toBe("gone");

    const relaunched = setup([meta()], true);
    relaunched.watch.observe(panes({ "mj-RIC-1": 7 }), relaunched.sessions.list());
    relaunched.watch.observe(panes({}), relaunched.sessions.list());
    relaunched.sessions.insert(meta({ createdAt: 2 }));
    await relaunched.flush();
    expect(relaunched.sessions.get("mj-RIC-1")).toMatchObject({ state: "running", endReason: null });
  });
});
