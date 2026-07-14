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
  const meta: SessionMeta = { kind: "lime", id: "mojito-RIC-46-to-code", ticket: "RIC-46", launchStatus: "To Code",
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
    await handleHook("mojito-RIC-46-to-code", "PermissionRequest", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("needs-input");
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-to-code", state: "needs-input" });
  });

  it("stop with a stage advance marks done and triggers auto-advance when enabled", async () => {
    const { registry } = seed({ autoAdvance: true });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-to-code", "Stop", {
      registry, bus, getIssueStatus: async () => "To Review", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("done");
    expect(onAutoAdvance).toHaveBeenCalledWith(expect.objectContaining({ ticket: "RIC-46" }), "To Review");
  });

  it("stop on a backward move (QA reject) does NOT advance", async () => {
    // A QA reject sets the ticket back to To Code (a Stage 2 rerun target). A stray
    // Stop from the To QA session must not be read as a completed stage and relaunch.
    const { registry } = seed({ autoAdvance: true, id: "mojito-RIC-46-to-qa", launchStatus: "To QA" });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-to-qa", "Stop", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-to-qa")?.state).not.toBe("done");
    expect(onAutoAdvance).not.toHaveBeenCalled();
  });

  it("stop with unchanged status is needs-input (claude asked something)", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-to-code", "Stop", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("needs-input");
  });

  it("ignores an unknown session id", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("nope", "Stop", { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    // no throw, nothing emitted
    expect(registry.get("nope")).toBeUndefined();
  });

  it("UserPromptSubmit clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude is waiting for you" });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-to-code", "UserPromptSubmit", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    const m = registry.get("mojito-RIC-46-to-code");
    expect(m?.state).toBe("running");
    expect(m?.message).toBeUndefined();
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-to-code", state: "running" });
  });

  it("PostToolUse (any tool) clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude needs your attention" });
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-to-code", "PostToolUse", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("running");
  });
});
