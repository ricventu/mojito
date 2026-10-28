import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/events/bus";

describe("EventBus", () => {
  it("delivers events to every subscriber", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    bus.emit({ type: "tickets.changed" });
    expect(a).toHaveBeenCalledWith({ type: "tickets.changed" });
    expect(b).toHaveBeenCalledWith({ type: "tickets.changed" });
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const off = bus.subscribe(a);
    off();
    bus.emit({ type: "tickets.changed" });
    expect(a).not.toHaveBeenCalled();
  });

  it("a throwing listener does not stop the others nor propagate", () => {
    const bus = new EventBus();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    bus.subscribe(() => {
      throw new Error("bad listener");
    });
    bus.subscribe(second);
    expect(() => bus.emit({ type: "tickets.changed" })).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
