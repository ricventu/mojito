import { afterEach, describe, expect, it, vi } from "vitest";
import type { MojitoEvent, TicketSummary } from "@mojito/shared";
import { EventBus } from "../../src/events/bus";
import { POLL_MS, TicketCache } from "../../src/tickets/cache";

const ticket = (identifier: string, title = "t"): TicketSummary => ({
  identifier,
  title,
  url: `https://linear.app/x/issue/${identifier}`,
  statusName: "Todo",
  statusType: "unstarted",
  project: "Mojito",
  labels: [],
  assignedToMe: false,
});

function setup(impl: () => Promise<TicketSummary[]>) {
  const listOpenIssues = vi.fn(impl);
  const bus = new EventBus();
  const events: MojitoEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const projects = vi.fn(() => ["Mojito"]);
  const cache = new TicketCache({ linear: { listOpenIssues }, projects, bus, now: () => 1234 });
  return { cache, listOpenIssues, events, projects };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TicketCache", () => {
  it("starts empty, never fetched", () => {
    const { cache } = setup(async () => []);
    expect(cache.snapshot()).toEqual({ tickets: [], fetchedAt: null, stale: false, error: null });
  });

  it("a successful refresh fills the snapshot and emits once", async () => {
    const { cache, events, listOpenIssues } = setup(async () => [ticket("RIC-1")]);
    await cache.refresh();
    expect(cache.snapshot()).toEqual({ tickets: [ticket("RIC-1")], fetchedAt: 1234, stale: false, error: null });
    expect(events).toEqual([{ type: "tickets.changed" }]);
    expect(listOpenIssues).toHaveBeenCalledWith(["Mojito"]);
  });

  it("an identical second refresh emits nothing", async () => {
    const { cache, events } = setup(async () => [ticket("RIC-1")]);
    await cache.refresh();
    await cache.refresh();
    expect(events).toHaveLength(1);
  });

  it("a changed list emits again", async () => {
    let n = 0;
    const { cache, events } = setup(async () => [ticket("RIC-1", `t${n++}`)]);
    await cache.refresh();
    await cache.refresh();
    expect(events).toHaveLength(2);
  });

  it("a failure after a success keeps the tickets and marks stale", async () => {
    let fail = false;
    const { cache, events } = setup(async () => {
      if (fail) throw new Error("boom");
      return [ticket("RIC-1")];
    });
    await cache.refresh();
    fail = true;
    await expect(cache.refresh()).resolves.toBeUndefined();
    expect(cache.snapshot()).toEqual({ tickets: [ticket("RIC-1")], fetchedAt: 1234, stale: true, error: "boom" });
    expect(events).toHaveLength(2);
    // same failure again: nothing changed, nothing emitted
    await cache.refresh();
    expect(events).toHaveLength(2);
  });

  it("a first failure gives an empty list with the error and no stale flag", async () => {
    const { cache, events } = setup(async () => {
      throw new Error("boom");
    });
    await expect(cache.refresh()).resolves.toBeUndefined();
    expect(cache.snapshot()).toEqual({ tickets: [], fetchedAt: null, stale: false, error: "boom" });
    expect(events).toEqual([{ type: "tickets.changed" }]);
  });

  it("recovers after a failure and clears stale/error", async () => {
    let fail = true;
    const { cache, events } = setup(async () => {
      if (fail) throw new Error("boom");
      return [ticket("RIC-1")];
    });
    await cache.refresh();
    fail = false;
    await cache.refresh();
    expect(cache.snapshot()).toEqual({ tickets: [ticket("RIC-1")], fetchedAt: 1234, stale: false, error: null });
    expect(events).toHaveLength(2);
  });

  it("concurrent refreshes share one request; a later one starts a new request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { cache, listOpenIssues } = setup(async () => {
      await gate;
      return [ticket("RIC-1")];
    });
    const a = cache.refresh();
    const b = cache.refresh();
    release();
    await Promise.all([a, b]);
    expect(listOpenIssues).toHaveBeenCalledTimes(1);
    await cache.refresh();
    expect(listOpenIssues).toHaveBeenCalledTimes(2);
  });

  it("get() reads the current list", async () => {
    const { cache } = setup(async () => [ticket("RIC-1"), ticket("RIC-2")]);
    expect(cache.get("RIC-2")).toBeNull();
    await cache.refresh();
    expect(cache.get("RIC-2")?.identifier).toBe("RIC-2");
    expect(cache.get("RIC-9")).toBeNull();
  });

  it("start() refreshes immediately then every POLL_MS; stop() ends it", async () => {
    vi.useFakeTimers();
    const { cache, listOpenIssues } = setup(async () => [ticket("RIC-1")]);
    cache.start();
    expect(listOpenIssues).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(listOpenIssues).toHaveBeenCalledTimes(2);
    cache.stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(listOpenIssues).toHaveBeenCalledTimes(2);
  });
});
