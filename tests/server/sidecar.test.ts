import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSidecar, readSidecar, listSidecars, removeSidecar } from "@/server/sidecar";
import type { SessionMeta } from "@/server/types";

const meta: SessionMeta = {
  kind: "ticket",
  id: "mojito-RIC-46-planned",
  ticket: "RIC-46",
  launchStatus: "Planned",
  model: "opus",
  effort: "high",
  state: "running",
  cwd: "/code/lime",
  createdAt: "2026-07-11T00:00:00.000Z",
  title: "Some ticket",
  labels: ["Feature"],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-"));
});

describe("sidecar", () => {
  it("round-trips a session", () => {
    writeSidecar(dir, meta);
    expect(readSidecar(dir, meta.id)).toEqual(meta);
  });
  it("lists and removes", () => {
    writeSidecar(dir, meta);
    expect(listSidecars(dir)).toHaveLength(1);
    removeSidecar(dir, meta.id);
    expect(listSidecars(dir)).toHaveLength(0);
  });
  it("returns null for a missing session", () => {
    expect(readSidecar(dir, "nope")).toBeNull();
  });

  it("defaults a missing kind to ticket when reading a legacy sidecar", () => {
    const sdir = join(dir, "sessions");
    mkdirSync(sdir, { recursive: true });
    // legacy sidecar: no `kind` field
    writeFileSync(join(sdir, "mojito-RIC-1-in-progress.json"), JSON.stringify({
      id: "mojito-RIC-1-in-progress", ticket: "RIC-1", launchStatus: "In Progress", model: "opus",
      effort: "high", state: "running", cwd: "/x",
      createdAt: "2026-07-11T00:00:00.000Z", title: "t", labels: [],
    }));
    expect(readSidecar(dir, "mojito-RIC-1-in-progress")?.kind).toBe("ticket");
  });

  it("maps a persisted lime kind to ticket when reading a legacy sidecar", () => {
    const sdir = join(dir, "sessions");
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, "mojito-RIC-1-todo.json"), JSON.stringify({
      kind: "lime", id: "mojito-RIC-1-todo", ticket: "RIC-1", launchStatus: "Todo", model: "opus",
      effort: "high", state: "running", cwd: "/x",
      createdAt: "2026-07-11T00:00:00.000Z", title: "t", labels: [],
    }));
    expect(readSidecar(dir, "mojito-RIC-1-todo")?.kind).toBe("ticket");
  });

  it("preserves an explicit kind", () => {
    const sdir = join(dir, "sessions");
    mkdirSync(sdir, { recursive: true });
    writeFileSync(join(sdir, "mojito-custom-general-abc.json"), JSON.stringify({
      kind: "custom", id: "mojito-custom-general-abc", ticket: "", launchStatus: "", model: "opus",
      effort: "high", state: "running", cwd: "/x",
      createdAt: "2026-07-11T00:00:00.000Z", title: "home", labels: [],
    }));
    expect(readSidecar(dir, "mojito-custom-general-abc")?.kind).toBe("custom");
  });
});
