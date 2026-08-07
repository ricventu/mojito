import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchSession, type LaunchRequest } from "@/server/launch";
import { Registry } from "@/server/registry";
import { _resetStageDefaultsCache } from "@/server/stageDefaults";
import { writeAutoScale, _resetScaleSettingsCache } from "@/server/scaleSettings";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-"));
  // Point stage-defaults at an empty config dir so the built-in seeds apply
  // (To Review/To Merge default to opus/xhigh) and auto-scale defaults to on.
  process.env.MOJITO_CONFIG_DIR = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  _resetStageDefaultsCache();
  _resetScaleSettingsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  _resetStageDefaultsCache();
  _resetScaleSettingsCache();
});

function deps(changedLines: (cwd: string) => number | null) {
  const commands: string[] = [];
  return {
    registry: new Registry(dir), stateDir: dir, port: 4711, token: "t", projectsPath: "/nope.json",
    hasSession: vi.fn(async () => false),
    newSession: vi.fn(async (_n: string, _c: string, command: string) => { commands.push(command); }),
    pipePane: vi.fn(async () => {}),
    resolveCwd: () => "/wt",
    changedLines,
    commands,
  };
}

function req(status: string, model = "opus", effort: LaunchRequest["effort"] = "xhigh"): LaunchRequest {
  return { ticket: "RIC-1", status, model, effort,
    autoAdvance: false, projectName: null, title: "t", labels: [], description: "" };
}

describe("launchSession diff-scaling", () => {
  it("downgrades a To Review launch at stage defaults when the diff is small", async () => {
    const seen: string[] = [];
    const d = deps((cwd) => { seen.push(cwd); return 40; });
    const res = await launchSession(req("To Review"), d);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meta.model).toBe("sonnet");
      expect(res.meta.effort).toBe("medium");
      // The pre-scaling profile is recorded so the UI can tell a downgrade from a choice.
      expect(res.meta.scaledFrom).toEqual({ model: "opus", effort: "xhigh" });
    }
    expect(d.commands[0]).toContain("--model 'sonnet'");
    expect(d.commands[0]).toContain("--effort 'medium'");
    // The diff is measured at the resolved session cwd (the worktree), nowhere else.
    expect(seen).toEqual(["/wt"]);
  });

  it("caps effort at high for a medium diff", async () => {
    const d = deps(() => 300);
    const res = await launchSession(req("To Merge"), d);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.meta.model).toBe("opus"); expect(res.meta.effort).toBe("high"); }
  });

  it("To Merge scales effort only — the merge-gating review keeps its model", async () => {
    const d = deps(() => 40);
    const res = await launchSession(req("To Merge"), d);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meta.model).toBe("opus");
      expect(res.meta.effort).toBe("medium");
      expect(res.meta.scaledFrom).toEqual({ model: "opus", effort: "xhigh" });
    }
  });

  it("never touches an explicit non-default profile", async () => {
    const d = deps(() => 40);
    const res = await launchSession(req("To Review", "fable", "xhigh"), d);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meta.model).toBe("fable");
      expect(res.meta.effort).toBe("xhigh");
      expect(res.meta.scaledFrom).toBeUndefined();
    }
  });

  it("never scales other statuses", async () => {
    const d = deps(() => 40);
    const res = await launchSession(req("To Code", "opus", "high"), d);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.meta.model).toBe("opus"); expect(res.meta.effort).toBe("high"); }
  });

  it("keeps the unscaled profile when the diff cannot be measured", async () => {
    const d = deps(() => null);
    const res = await launchSession(req("To Review"), d);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.meta.model).toBe("opus"); expect(res.meta.effort).toBe("xhigh"); }
  });

  it("never scales when the auto-scale setting is off", async () => {
    writeAutoScale(false);
    const d = deps(() => 40);
    const res = await launchSession(req("To Review"), d);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.meta.model).toBe("opus");
      expect(res.meta.effort).toBe("xhigh");
      expect(res.meta.scaledFrom).toBeUndefined();
    }
  });
});
