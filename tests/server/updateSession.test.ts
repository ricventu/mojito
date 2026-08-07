import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateAutoAdvance } from "@/server/updateSession";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";

let dir: string;
function seed(over: Partial<SessionMeta> = {}): Registry {
  const registry = new Registry(dir);
  const meta: SessionMeta = { kind: "ticket", id: "mojito-RIC-46-planned", ticket: "RIC-46", launchStatus: "Planned",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "Some ticket", labels: [], ...over };
  registry.upsert(meta);
  return registry;
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("updateAutoAdvance", () => {
  it("flips the flag, persists it, and emits a state event", () => {
    const registry = seed({ autoAdvance: false });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));

    const result = updateAutoAdvance("mojito-RIC-46-planned", true, { registry, bus });

    expect(result?.autoAdvance).toBe(true);
    expect(registry.get("mojito-RIC-46-planned")?.autoAdvance).toBe(true);
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-planned", state: "running" });
  });

  it("can turn the flag off", () => {
    const registry = seed({ autoAdvance: true });
    const bus = new EventBus();
    const result = updateAutoAdvance("mojito-RIC-46-planned", false, { registry, bus });
    expect(result?.autoAdvance).toBe(false);
  });

  it("returns null and emits nothing for an unknown id", () => {
    const registry = seed();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));

    const result = updateAutoAdvance("nope", true, { registry, bus });

    expect(result).toBeNull();
    expect(events).toEqual([]);
  });
});
