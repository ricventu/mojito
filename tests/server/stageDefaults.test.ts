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
    expect(defaultModelForStatus("In Progress")).toBe("opus");
    expect(defaultEffortForStatus("In Progress")).toBe("high");
    expect(defaultEffortForStatus("Todo")).toBe("high");
  });
});

describe("override file present", () => {
  it("layers overrides over built-ins", () => {
    writeFileSync(configPath(), JSON.stringify({ "In Progress": { model: "fable", effort: "max" } }));
    _resetStageDefaultsCache();
    expect(defaultModelForStatus("In Progress")).toBe("fable");
    expect(defaultEffortForStatus("In Progress")).toBe("max");
    expect(defaultModelForStatus("Todo")).toBe("opus"); // untouched -> built-in
  });
});

describe("invalid entry in override file", () => {
  it("drops the invalid entry and falls back to the built-in, keeping valid entries", () => {
    writeFileSync(configPath(), JSON.stringify({
      "In Progress": { model: "gpt", effort: "ultra" },
      "Todo": { model: "opus", effort: "medium" },
    }));
    _resetStageDefaultsCache();
    expect(defaultModelForStatus("In Progress")).toBe("opus"); // fell back to built-in
    expect(defaultModelForStatus("Todo")).toBe("opus"); // valid override applied
  });
});

describe("corrupt file", () => {
  it("is treated as no overrides and does not throw", () => {
    writeFileSync(configPath(), "{ not json");
    _resetStageDefaultsCache();
    expect(() => readOverrides()).not.toThrow();
    expect(readOverrides()).toEqual({});
    expect(defaultModelForStatus("In Progress")).toBe("opus");
  });
});

describe("writeOverrides", () => {
  it("persists, creates the dir, and invalidates the cache", () => {
    const nested = join(dir, "deep");
    process.env.MOJITO_CONFIG_DIR = nested;
    _resetStageDefaultsCache();
    writeOverrides({ "In Progress": { model: "opus", effort: "medium" } });
    expect(JSON.parse(readFileSync(join(nested, "stage-defaults.json"), "utf8")))
      .toEqual({ "In Progress": { model: "opus", effort: "medium" } });
    expect(defaultModelForStatus("In Progress")).toBe("opus");
    expect(readEffective()["In Progress"]).toEqual({ model: "opus", effort: "medium" });
  });
});
