import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleHook } from "@/server/hookHandler";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";

let dir: string;
function seed(over: Partial<SessionMeta> = {}): { registry: Registry; meta: SessionMeta } {
  const registry = new Registry(dir);
  const meta: SessionMeta = { id: "mojito-RIC-46-planned", ticket: "RIC-46", launchStatus: "Planned",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "Some ticket", labels: [], ...over };
  registry.upsert(meta);
  return { registry, meta };
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("handleHook", () => {
  it("permission request flips to needs-input and emits an alert", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-planned", "PermissionRequest", {
      registry, bus, getIssueStatus: async () => "Planned", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).toBe("needs-input");
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-planned", state: "needs-input" });
  });

  it("stop with a stage advance marks done and triggers auto-advance when enabled", async () => {
    const { registry } = seed({ autoAdvance: true });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-planned", "Stop", {
      registry, bus, getIssueStatus: async () => "To Review", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).toBe("done");
    expect(onAutoAdvance).toHaveBeenCalledWith(expect.objectContaining({ ticket: "RIC-46" }), "To Review");
  });

  it("stop while status only moved within the same stage does NOT advance", async () => {
    // Planned→In Progress is Stage 2 marking itself in-flight, not a handoff.
    // Marking done here would spuriously launch a duplicate Stage 2 session.
    const { registry } = seed({ autoAdvance: true });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-planned", "Stop", {
      registry, bus, getIssueStatus: async () => "In Progress", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).not.toBe("done");
    expect(onAutoAdvance).not.toHaveBeenCalled();
  });

  it("stop with unchanged status is needs-input (claude asked something)", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-planned", "Stop", {
      registry, bus, getIssueStatus: async () => "Planned", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-planned")?.state).toBe("needs-input");
  });

  it("ignores an unknown session id", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("nope", "Stop", { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    // no throw, nothing emitted
    expect(registry.get("nope")).toBeUndefined();
  });
});
