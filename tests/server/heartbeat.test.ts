import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markAlive, startHeartbeat } from "@/server/heartbeat";

/** Minimal `ws` stand-in: records handlers, ping/terminate, and an isAlive flag. */
function fakeWs() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  return {
    isAlive: undefined as boolean | undefined,
    on: vi.fn((ev: string, h: (...a: unknown[]) => void) => { handlers[ev] = h; }),
    ping: vi.fn(),
    terminate: vi.fn(),
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
  };
}

describe("heartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("markAlive marks the socket alive, and a pong keeps it alive", () => {
    const ws = fakeWs();
    markAlive(ws as never);
    expect(ws.isAlive).toBe(true);
    ws.isAlive = false;
    ws.emit("pong");
    expect(ws.isAlive).toBe(true);
  });

  it("pings live clients each tick and terminates ones that never ponged", () => {
    const live = fakeWs(); markAlive(live as never);
    const dead = fakeWs(); markAlive(dead as never);
    const stop = startHeartbeat({ clients: new Set([live, dead]) } as never, 30_000);

    // First tick: both were alive -> both pinged, both flipped to not-alive.
    vi.advanceTimersByTime(30_000);
    expect(live.ping).toHaveBeenCalledTimes(1);
    expect(dead.ping).toHaveBeenCalledTimes(1);
    expect(live.terminate).not.toHaveBeenCalled();
    expect(dead.terminate).not.toHaveBeenCalled();

    // `live` pongs back (resets isAlive); `dead` stays silent.
    live.emit("pong");

    // Second tick: dead is still not-alive -> terminated; live is pinged again.
    vi.advanceTimersByTime(30_000);
    expect(dead.terminate).toHaveBeenCalledTimes(1);
    expect(live.ping).toHaveBeenCalledTimes(2);
    expect(live.terminate).not.toHaveBeenCalled();
    stop();
  });

  it("stop() halts further pings", () => {
    const ws = fakeWs(); markAlive(ws as never);
    const stop = startHeartbeat({ clients: new Set([ws]) } as never, 30_000);
    stop();
    vi.advanceTimersByTime(120_000);
    expect(ws.ping).not.toHaveBeenCalled();
  });
});
