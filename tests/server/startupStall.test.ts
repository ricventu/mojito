import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchStartupStall, STALL_GRACE_MS } from "@/server/startupStall";
import { Registry } from "@/server/registry";
import { EventBus, type MojitoEvent } from "@/server/events";
import type { SessionMeta, SessionState } from "@/server/types";

const ID = "mojito-custom-general-810931";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

function seed(state: SessionState = "starting", kind: SessionMeta["kind"] = "custom"): Registry {
  const registry = new Registry(dir);
  registry.upsert({
    kind, id: ID, ticket: kind === "custom" ? "" : "RIC-222", launchStatus: "", model: "opus",
    effort: "high", state, cwd: "/Users/ricventu", createdAt: "2026-08-19T16:20:44.878Z",
    title: "home", labels: [],
  });
  return registry;
}

// A captured timer: the callback and the delay it was armed with, fired by hand.
function fakeSchedule() {
  const calls: { ms: number; fn: () => void }[] = [];
  const scheduleStall = (fn: () => void, ms: number) => { calls.push({ fn, ms }); };
  return { calls, scheduleStall };
}

function harness(state: SessionState = "starting", alive = true) {
  const registry = seed(state);
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { calls, scheduleStall } = fakeSchedule();
  const hasSession = vi.fn(async () => alive);
  return { registry, bus, events, calls, scheduleStall, hasSession };
}

describe("watchStartupStall", () => {
  it("arms a timer for the grace period", () => {
    const h = harness();
    watchStartupStall(ID, h);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].ms).toBe(STALL_GRACE_MS);
  });

  // The bug this module exists for (RIC-222): the state machine is driven entirely by
  // Claude Code hooks, and the first of them (SessionStart) only fires once claude has
  // booted. A cwd Claude Code does not trust blocks it on the workspace-trust prompt
  // before that, so no hook ever arrives and the session stays pinned at "starting"
  // while it is in fact waiting for the human.
  it("turns a launch still at starting into needs-input, with an alert", async () => {
    const h = harness();
    watchStartupStall(ID, h);
    await h.calls[0].fn();

    expect(h.registry.get(ID)?.state).toBe("needs-input");
    expect(h.registry.get(ID)?.message).toMatch(/terminal/);
    expect(h.events).toEqual([
      { type: "session.state", id: ID, state: "needs-input" },
      { type: "session.alert", id: ID, kind: "needs-input", ticket: "", message: h.registry.get(ID)!.message },
    ]);
  });

  it("leaves a session a hook has already moved alone", async () => {
    const h = harness("running");
    watchStartupStall(ID, h);
    await h.calls[0].fn();

    expect(h.registry.get(ID)?.state).toBe("running");
    expect(h.events).toEqual([]);
    expect(h.hasSession).not.toHaveBeenCalled(); // no tmux probe needed once a hook has spoken
  });

  // A tmux that never came up (or died on the spot) is not a human-input problem, and it
  // already has an owner: Registry.recover at boot, and sweepOrphans. Claiming it needs
  // input would put an un-openable terminal at the top of the board.
  it("leaves a session whose tmux is gone alone", async () => {
    const h = harness("starting", false);
    watchStartupStall(ID, h);
    await h.calls[0].fn();

    expect(h.registry.get(ID)?.state).toBe("starting");
    expect(h.events).toEqual([]);
  });

  // Without a bus the flip would be invisible: the client refetches the session list only
  // on an event, and a stalled launch produces none of its own.
  it("does not arm anything without a bus", () => {
    const h = harness();
    watchStartupStall(ID, { ...h, bus: undefined });
    expect(h.calls).toHaveLength(0);
  });

  it("honours an overridden grace period", () => {
    const h = harness();
    watchStartupStall(ID, { ...h, stallGraceMs: 50 });
    expect(h.calls[0].ms).toBe(50);
  });
});
