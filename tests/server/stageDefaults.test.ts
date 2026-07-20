import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configPath, readOverrides, readEffective, writeOverrides,
  defaultModelForStatus, defaultEffortForStatus, _resetStageDefaultsCache,
} from "@/server/stageDefaults";

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

describe("configPath", () => {
  it("uses MOJITO_CONFIG_DIR when set", () => {
    expect(configPath()).toBe(join(dir, "stage-defaults.json"));
  });
  it("falls back to XDG_CONFIG_HOME/mojito", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/x" } as unknown as NodeJS.ProcessEnv))
      .toBe(join("/x", "mojito", "stage-defaults.json"));
  });
});

describe("no file present", () => {
  it("readOverrides is empty and effective equals the built-ins", () => {
    expect(readOverrides()).toEqual({});
    expect(defaultModelForStatus("To QA")).toBe("sonnet");
    expect(defaultModelForStatus("To Review")).toBe("opus");
    expect(defaultEffortForStatus("To Review")).toBe("xhigh");
    expect(defaultEffortForStatus("In Progress")).toBe("high");
  });
});

describe("override file present", () => {
  it("layers overrides over built-ins", () => {
    writeFileSync(configPath(), JSON.stringify({ "To Review": { model: "fable", effort: "max" } }));
    _resetStageDefaultsCache();
    expect(defaultModelForStatus("To Review")).toBe("fable");
    expect(defaultEffortForStatus("To Review")).toBe("max");
    expect(defaultModelForStatus("To QA")).toBe("sonnet"); // untouched -> built-in
  });
});

describe("corrupt file", () => {
  it("is treated as no overrides and does not throw", () => {
    writeFileSync(configPath(), "{ not json");
    _resetStageDefaultsCache();
    expect(() => readOverrides()).not.toThrow();
    expect(readOverrides()).toEqual({});
    expect(defaultModelForStatus("To QA")).toBe("sonnet");
  });
});

describe("writeOverrides", () => {
  it("persists, creates the dir, and invalidates the cache", () => {
    const nested = join(dir, "deep");
    process.env.MOJITO_CONFIG_DIR = nested;
    _resetStageDefaultsCache();
    writeOverrides({ "To QA": { model: "opus", effort: "medium" } });
    expect(JSON.parse(readFileSync(join(nested, "stage-defaults.json"), "utf8")))
      .toEqual({ "To QA": { model: "opus", effort: "medium" } });
    expect(defaultModelForStatus("To QA")).toBe("opus");
    expect(readEffective()["To QA"]).toEqual({ model: "opus", effort: "medium" });
  });
});
