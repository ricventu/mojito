import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@/server/registry";
import { writeSidecar } from "@/server/sidecar";
import { writeLaunchContext } from "@/server/launchContext";
import { adoptOrphanSessions } from "@/server/adoptOrphans";
import type { SessionMeta } from "@/server/types";

function meta(id: string): SessionMeta {
  return { kind: "ticket", id, ticket: "RIC-1", launchStatus: "Todo", model: "opus", effort: "high",
    state: "running", cwd: "/x", createdAt: "2026-07-11T00:00:00.000Z", title: "t", labels: [] };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("adoptOrphanSessions", () => {
  it("leaves an already-registered live session untouched", () => {
    const r = new Registry(dir);
    r.upsert(meta("mojito-RIC-1-work"));
    adoptOrphanSessions(r, dir, "/projects.json", ["mojito-RIC-1-work"]);
    expect(r.get("mojito-RIC-1-work")).toEqual(meta("mojito-RIC-1-work"));
  });

  it("adopts an orphaned ticket session using its launch context", () => {
    const r = new Registry(dir);
    writeLaunchContext(dir, "mojito-RIC-203-work", {
      identifier: "RIC-203", statusName: "Todo", title: "Multi utente",
      project: "Factorybook", labels: ["Feature"], description: "...",
    });
    adoptOrphanSessions(r, dir, "/projects.json", ["mojito-RIC-203-work"], {
      resolveCwd: () => "/code/factorybook/.claude/worktrees/RIC-203-multi-utente",
    });
    const adopted = r.get("mojito-RIC-203-work");
    expect(adopted).toMatchObject({
      kind: "ticket", id: "mojito-RIC-203-work", ticket: "RIC-203", launchStatus: "Todo",
      title: "Multi utente", labels: ["Feature"], projectName: "Factorybook",
      cwd: "/code/factorybook/.claude/worktrees/RIC-203-multi-utente", state: "running",
    });
  });

  it("still adopts a ticket session with a visible (if minimal) entry when its context file is gone", () => {
    const r = new Registry(dir);
    adoptOrphanSessions(r, dir, "/projects.json", ["mojito-RIC-9-work"]);
    const adopted = r.get("mojito-RIC-9-work");
    expect(adopted).toMatchObject({ kind: "ticket", id: "mojito-RIC-9-work", ticket: "RIC-9", state: "running" });
  });

  it("adopts an orphaned custom/shell session with the bare id as its title", () => {
    const r = new Registry(dir);
    adoptOrphanSessions(r, dir, "/projects.json", ["mojito-custom-mojito-abc123", "mojito-shell-general-def456"]);
    expect(r.get("mojito-custom-mojito-abc123")).toMatchObject({ kind: "custom", ticket: "", title: "mojito-custom-mojito-abc123" });
    expect(r.get("mojito-shell-general-def456")).toMatchObject({ kind: "shell", ticket: "", title: "mojito-shell-general-def456" });
  });

  it("never touches a session that is registered but no longer live (recover()'s job, not this one)", () => {
    writeSidecar(dir, meta("mojito-RIC-1-work")); // written before the registry loads it, like registry.test.ts's own pattern
    const r = new Registry(dir);
    adoptOrphanSessions(r, dir, "/projects.json", []); // nothing live
    expect(r.get("mojito-RIC-1-work")?.state).toBe("running"); // unchanged — recover() handles this
  });
});
