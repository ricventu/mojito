import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@/server/registry";
import { writeSidecar } from "@/server/sidecar";
import type { SessionMeta } from "@/server/types";

function meta(id: string, state: SessionMeta["state"] = "running"): SessionMeta {
  return { kind: "lime", id, ticket: "RIC-46", launchStatus: "Planned", model: "opus", effort: "high",
    autoAdvance: false, state, cwd: "/x", createdAt: "2026-07-11T00:00:00.000Z",
    title: "Some ticket", labels: [] };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("Registry", () => {
  it("upserts and patches with persistence", () => {
    const r = new Registry(dir);
    r.upsert(meta("a"));
    r.patch("a", { state: "needs-input", message: "hi" });
    expect(r.get("a")?.state).toBe("needs-input");
    expect(new Registry(dir).get("a")?.state).toBe("needs-input"); // reloaded from disk
  });

  it("recovers sidecars and fails dead running sessions", () => {
    writeSidecar(dir, meta("alive"));
    writeSidecar(dir, meta("dead"));
    writeSidecar(dir, meta("finished", "done"));
    const r = new Registry(dir);
    r.recover(["alive"]);
    expect(r.get("alive")?.state).toBe("running");
    expect(r.get("dead")?.state).toBe("failed");
    expect(r.get("finished")?.state).toBe("done"); // done stays done
  });
});
