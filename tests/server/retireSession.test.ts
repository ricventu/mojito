import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retireDeadSession } from "@/server/retireSession";
import { Registry } from "@/server/registry";
import type { SessionMeta, SessionState } from "@/server/types";

const ID = "mojito-RIC-107-work";
const sidecarPath = (stateDir: string, id: string) => join(stateDir, "sessions", `${id}.json`);

let dir: string;
function seed(id: string, state: SessionState = "done"): Registry {
  const registry = new Registry(dir);
  const meta: SessionMeta = {
    kind: "ticket", id, ticket: "RIC-107", launchStatus: "Todo", model: "opus", effort: "high",
    state, cwd: "/x", createdAt: "2026-07-13T00:00:00.000Z",
    title: "scroll", labels: [],
  };
  registry.upsert(meta);
  return registry;
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("retireDeadSession", () => {
  it("drops the registration (and its sidecar) once the tmux session is gone", async () => {
    const registry = seed(ID);
    expect(existsSync(sidecarPath(dir, ID))).toBe(true);
    const hasSession = vi.fn(async () => false);

    expect(await retireDeadSession(ID, { hasSession, registry })).toBe(true);

    expect(hasSession).toHaveBeenCalledWith(ID);
    expect(registry.get(ID)).toBeUndefined();
    expect(existsSync(sidecarPath(dir, ID))).toBe(false);
  });

  // The invariant this module exists to hold: Mojito ends a session only on an explicit
  // user action (the Kill button -> DELETE /api/sessions/[id]). A live predecessor stays
  // registered and attachable, however finished Mojito believes its stage to be.
  it("leaves a live session alone — registered, and never closed", async () => {
    const registry = seed(ID, "running");
    const hasSession = vi.fn(async () => true);

    expect(await retireDeadSession(ID, { hasSession, registry })).toBe(false);

    expect(registry.get(ID)?.state).toBe("running");
    expect(existsSync(sidecarPath(dir, ID))).toBe(true);
  });

  it("is a no-op for an id that was never registered", async () => {
    const registry = new Registry(dir);
    expect(await retireDeadSession(ID, { hasSession: async () => false, registry })).toBe(true);
    expect(registry.all()).toEqual([]);
  });
});
