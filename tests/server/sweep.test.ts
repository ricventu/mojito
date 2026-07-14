import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepOrphans } from "@/server/sweep";
import { Registry } from "@/server/registry";
import type { SessionMeta } from "@/server/types";

const sidecarPath = (stateDir: string, id: string) => join(stateDir, "sessions", `${id}.json`);

let dir: string;
function seed(id: string, registry: Registry): void {
  const meta: SessionMeta = {
    kind: "lime", id, ticket: "RIC-107", launchStatus: "To Review", model: "opus", effort: "high",
    autoAdvance: true, state: "running", cwd: "/x", createdAt: "2026-07-13T00:00:00.000Z",
    title: "scroll", labels: [],
  };
  registry.upsert(meta);
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("sweepOrphans", () => {
  it("removes only sessions whose tmux is gone, keeping live ones", async () => {
    const registry = new Registry(dir);
    seed("mojito-RIC-1-live", registry);
    seed("mojito-RIC-2-dead", registry);
    seed("mojito-RIC-3-dead", registry);
    const live = new Set(["mojito-RIC-1-live"]);
    const hasSession = async (name: string) => live.has(name);

    const removed = await sweepOrphans({ registry, hasSession });

    expect(removed.sort()).toEqual(["mojito-RIC-2-dead", "mojito-RIC-3-dead"]);
    expect(registry.all().map((m) => m.id)).toEqual(["mojito-RIC-1-live"]);
    expect(existsSync(sidecarPath(dir, "mojito-RIC-1-live"))).toBe(true);
    expect(existsSync(sidecarPath(dir, "mojito-RIC-2-dead"))).toBe(false);
    expect(existsSync(sidecarPath(dir, "mojito-RIC-3-dead"))).toBe(false);
  });

  it("returns an empty list when every session is live", async () => {
    const registry = new Registry(dir);
    seed("mojito-RIC-1-live", registry);
    const hasSession = async () => true;

    const removed = await sweepOrphans({ registry, hasSession });

    expect(removed).toEqual([]);
    expect(registry.all()).toHaveLength(1);
  });
});
