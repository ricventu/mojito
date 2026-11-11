import { describe, expect, it } from "vitest";
import { DeferredActions, type Timers } from "../../src/lib/deferred";

function fakeTimers() {
  let next = 0;
  const due = new Map<number, () => void>();
  const timers: Timers = {
    set: (fn) => {
      due.set(++next, fn);
      return next;
    },
    clear: (handle) => due.delete(handle as number),
  };
  const fire = () => {
    const fns = [...due.values()];
    due.clear();
    for (const fn of fns) fn();
  };
  return { timers, fire, count: () => due.size };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("DeferredActions", () => {
  it("runs the action after the delay and keeps the key pending until it settles", async () => {
    const t = fakeTimers();
    const actions = new DeferredActions(t.timers);
    let resolve!: () => void;
    let runs = 0;
    actions.schedule("RIC-1", () => {
      runs++;
      return new Promise<void>((r) => (resolve = r));
    }, 3000);
    expect(actions.snapshot().has("RIC-1")).toBe(true);
    expect(runs).toBe(0);

    t.fire();
    await settle();
    expect(runs).toBe(1);
    expect(actions.snapshot().has("RIC-1")).toBe(true);

    resolve();
    await settle();
    expect(actions.snapshot().has("RIC-1")).toBe(false);
  });

  it("undo before the delay cancels the action", async () => {
    const t = fakeTimers();
    const actions = new DeferredActions(t.timers);
    let runs = 0;
    actions.schedule("RIC-1", () => runs++, 3000);
    expect(actions.undo("RIC-1")).toBe(true);
    expect(actions.snapshot().has("RIC-1")).toBe(false);
    expect(t.count()).toBe(0);
    t.fire();
    await settle();
    expect(runs).toBe(0);
  });

  it("undo is refused once the action has started, and for an unknown key", async () => {
    const t = fakeTimers();
    const actions = new DeferredActions(t.timers);
    actions.schedule("RIC-1", () => new Promise(() => {}), 3000);
    t.fire();
    await settle();
    expect(actions.undo("RIC-1")).toBe(false);
    expect(actions.undo("RIC-2")).toBe(false);
  });

  it("a second schedule of a pending key is ignored", () => {
    const t = fakeTimers();
    const actions = new DeferredActions(t.timers);
    expect(actions.schedule("RIC-1", () => {}, 3000)).toBe(true);
    expect(actions.schedule("RIC-1", () => {}, 3000)).toBe(false);
    expect(t.count()).toBe(1);
  });

  it("a failed action clears its key too", async () => {
    const t = fakeTimers();
    const actions = new DeferredActions(t.timers);
    actions.schedule("RIC-1", () => Promise.reject(new Error("no")), 3000);
    t.fire();
    await settle();
    expect(actions.snapshot().has("RIC-1")).toBe(false);
  });

  it("notifies on every change with a new snapshot", () => {
    const t = fakeTimers();
    const actions = new DeferredActions(t.timers);
    const seen: ReadonlySet<string>[] = [];
    const off = actions.subscribe(() => seen.push(actions.snapshot()));
    actions.schedule("RIC-1", () => {}, 3000);
    actions.undo("RIC-1");
    off();
    actions.schedule("RIC-2", () => {}, 3000);
    expect(seen.map((s) => [...s])).toEqual([["RIC-1"], []]);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
