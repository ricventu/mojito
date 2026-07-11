import { describe, it, expect, vi } from "vitest";
import { EventBus } from "@/server/events";

describe("EventBus", () => {
  it("delivers to subscribers and supports unsubscribe", () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.subscribe(spy);
    bus.emit({ type: "session.state", id: "a", state: "running" });
    expect(spy).toHaveBeenCalledOnce();
    off();
    bus.emit({ type: "session.state", id: "a", state: "done" });
    expect(spy).toHaveBeenCalledOnce();
  });
});
