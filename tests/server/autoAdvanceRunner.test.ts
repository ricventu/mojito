import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAutoAdvanceRequest } from "@/server/autoAdvanceRunner";
import { configPath, _resetStageDefaultsCache } from "@/server/stageDefaults";
import type { SessionMeta } from "@/server/types";

const prev: SessionMeta = {
  kind: "ticket", id: "mojito-RIC-1-to-code", ticket: "RIC-1", launchStatus: "To Code",
  model: "fable", effort: "high", autoAdvance: true, state: "done", cwd: "/x",
  createdAt: "2026-01-01T00:00:00Z", projectName: "Mojito", title: "T", labels: ["bug"],
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  _resetStageDefaultsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("buildAutoAdvanceRequest", () => {
  it("uses the target status's default model, NOT the inherited one (the fable bug)", () => {
    const req = buildAutoAdvanceRequest(prev, "To Review");
    expect(req.model).toBe("opus");   // built-in for To Review, not prev.model "fable"
    expect(req.effort).toBe("xhigh");
  });
  it("carries ticket context forward and targets the new status", () => {
    const req = buildAutoAdvanceRequest(prev, "To Review");
    expect(req).toMatchObject({
      ticket: "RIC-1", status: "To Review", autoAdvance: true,
      projectName: "Mojito", title: "T", labels: ["bug"],
    });
  });
  it("honors an override file for the model", () => {
    writeFileSync(configPath(), JSON.stringify({ "To Review": { model: "fable", effort: "max" } }));
    _resetStageDefaultsCache();
    const req = buildAutoAdvanceRequest(prev, "To Review");
    expect(req.model).toBe("fable");
    expect(req.effort).toBe("max");
  });
});
