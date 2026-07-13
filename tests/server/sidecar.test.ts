import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSidecar, readSidecar, listSidecars, removeSidecar } from "@/server/sidecar";
import type { SessionMeta } from "@/server/types";

const meta: SessionMeta = {
  id: "mojito-RIC-46-planned",
  ticket: "RIC-46",
  launchStatus: "Planned",
  model: "opus",
  effort: "high",
  autoAdvance: false,
  state: "running",
  cwd: "/code/lime",
  createdAt: "2026-07-11T00:00:00.000Z",
  title: "Auto-advance toggle",
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
});
