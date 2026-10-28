import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/events/bus";
import { attachEvents } from "../../src/ws/events";

function fakeWs() {
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  return {
    on: vi.fn((ev: string, h: (...a: unknown[]) => void) => {
      handlers[ev] = h;
    }),
    send: vi.fn(),
    close: vi.fn(),
    emit: (ev: string, ...a: unknown[]) => handlers[ev]?.(...a),
  };
}

describe("attachEvents", () => {
  it("sends one JSON frame per event", () => {
    const bus = new EventBus();
    const ws = fakeWs();
    attachEvents(ws as never, bus);
    bus.emit({ type: "tickets.changed" });
    bus.emit({ type: "session.removed", id: "mj-RIC-1" });
    expect(ws.send.mock.calls.map((c) => JSON.parse(c[0] as string))).toEqual([
      { type: "tickets.changed" },
      { type: "session.removed", id: "mj-RIC-1" },
    ]);
  });

  it("stops sending once the socket closes", () => {
    const bus = new EventBus();
    const ws = fakeWs();
    attachEvents(ws as never, bus);
    ws.emit("close");
    bus.emit({ type: "tickets.changed" });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it("survives a send on a socket that is already gone", () => {
    const bus = new EventBus();
    const ws = fakeWs();
    ws.send.mockImplementation(() => {
      throw new Error("not open");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    attachEvents(ws as never, bus);
    bus.emit({ type: "tickets.changed" });
    // The bus would catch and log a throwing listener; the listener itself must not throw.
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
