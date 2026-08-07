import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supersedeSession } from "@/server/supersede";
import { Registry } from "@/server/registry";
import type { SessionMeta } from "@/server/types";

const sidecarPath = (stateDir: string, id: string) => join(stateDir, "sessions", `${id}.json`);

let dir: string;
function seed(id: string): Registry {
  const registry = new Registry(dir);
  const meta: SessionMeta = {
    kind: "ticket", id, ticket: "RIC-107", launchStatus: "Todo", model: "opus", effort: "high",
    autoAdvance: true, state: "done", cwd: "/x", createdAt: "2026-07-13T00:00:00.000Z",
    title: "scroll", labels: [],
  };
  registry.upsert(meta);
  return registry;
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("supersedeSession", () => {
  it("gracefully closes the predecessor and deregisters it (sidecar removed)", async () => {
    const registry = seed("mojito-RIC-107-todo");
    expect(existsSync(sidecarPath(dir, "mojito-RIC-107-todo"))).toBe(true);
    const closeSession = vi.fn(async () => ({ closed: true, forced: false }));

    await supersedeSession("mojito-RIC-107-todo", { closeSession, registry });

    expect(closeSession).toHaveBeenCalledWith("mojito-RIC-107-todo");
    expect(registry.get("mojito-RIC-107-todo")).toBeUndefined();
    expect(existsSync(sidecarPath(dir, "mojito-RIC-107-todo"))).toBe(false);
  });
});
