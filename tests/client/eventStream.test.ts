import { describe, it, expect, vi } from "vitest";
import { openEventStream, EVENT_RETRY_MS, type EventSocket, type Schedule } from "@/lib/eventStream";
import type { MojitoEvent } from "@/server/events";

/** A socket whose open/message/close can be driven by hand, like a real one is by the network. */
function fakeSocket() {
  const s: EventSocket & { closed: boolean } = {
    onopen: null, onmessage: null, onclose: null, closed: false,
    close() { this.closed = true; },
  };
  return {
    socket: s,
    open: () => s.onopen?.(),
    deliver: (e: MojitoEvent) => s.onmessage?.({ data: JSON.stringify(e) }),
    drop: () => s.onclose?.(),
  };
}

/** Collects scheduled retries instead of waiting for them. */
function fakeClock() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule: Schedule = (fn, ms) => {
    const entry = { fn, ms, cancelled: false };
    pending.push(entry);
    return () => { entry.cancelled = true; };
  };
  return {
    schedule,
    pending,
    run: () => {
      const due = pending.splice(0).filter((p) => !p.cancelled);
      for (const p of due) p.fn();
      return due.length;
    },
  };
}

const STATE: MojitoEvent = { type: "session.state", id: "mojito-intake-mojito-abc", state: "running" };

describe("openEventStream", () => {
  it("delivers parsed events to onEvent", () => {
    const s = fakeSocket();
    const onEvent = vi.fn();
    openEventStream(() => s.socket, { onEvent });
    s.deliver(STATE);
    expect(onEvent).toHaveBeenCalledWith(STATE);
  });

  it("reports the very first connection through onConnect", () => {
    const s = fakeSocket();
    const onConnect = vi.fn();
    openEventStream(() => s.socket, { onEvent: vi.fn(), onConnect });
    s.open();
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  // RIC-251, the whole point of onConnect: nothing replays what was emitted while the
  // socket was down, so the caller has to refetch on every reconnection or stay frozen at
  // the last state it heard — "starting", for a session that had just launched.
  it("reports every reconnection, so the caller can resync what it missed", () => {
    const sockets = [fakeSocket(), fakeSocket()];
    let dialled = 0;
    const clock = fakeClock();
    const onConnect = vi.fn();
    openEventStream(() => sockets[dialled++].socket, { onEvent: vi.fn(), onConnect }, clock.schedule);

    sockets[0].open();
    sockets[0].drop();
    expect(clock.pending[0].ms).toBe(EVENT_RETRY_MS);
    clock.run();
    expect(dialled).toBe(2);

    sockets[1].open();
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it("keeps delivering events over the reconnected socket", () => {
    const sockets = [fakeSocket(), fakeSocket()];
    let dialled = 0;
    const clock = fakeClock();
    const onEvent = vi.fn();
    openEventStream(() => sockets[dialled++].socket, { onEvent }, clock.schedule);
    sockets[0].drop();
    clock.run();
    sockets[1].deliver(STATE);
    expect(onEvent).toHaveBeenCalledWith(STATE);
  });

  it("stops reconnecting once disposed, and closes the live socket", () => {
    const s = fakeSocket();
    let dialled = 0;
    const clock = fakeClock();
    const dispose = openEventStream(() => { dialled++; return s.socket; }, { onEvent: vi.fn() }, clock.schedule);
    dispose();
    expect(s.socket.closed).toBe(true);
    // A close that arrives after disposal must not restart the loop: the effect that owns
    // this stream has already been torn down, and a second socket would outlive it.
    s.drop();
    expect(clock.run()).toBe(0);
    expect(dialled).toBe(1);
  });

  it("cancels a pending retry on dispose", () => {
    const s = fakeSocket();
    const clock = fakeClock();
    const dispose = openEventStream(() => s.socket, { onEvent: vi.fn() }, clock.schedule);
    s.drop();
    expect(clock.pending).toHaveLength(1);
    dispose();
    expect(clock.run()).toBe(0);
  });

  it("works with no onConnect at all", () => {
    const s = fakeSocket();
    openEventStream(() => s.socket, { onEvent: vi.fn() });
    expect(() => s.open()).not.toThrow();
  });
});
