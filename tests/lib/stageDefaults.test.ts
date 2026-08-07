import { describe, it, expect } from "vitest";
import {
  BUILTIN_STAGE_DEFAULTS, LAUNCHABLE_STATUSES, STAGE_DEFAULT_ROWS,
  resolveModel, resolveEffort, mergeEffective, validateStageDefaults,
  sanitizeOverrides, minimalOverrides,
} from "@/lib/stageDefaults";

describe("built-in seed defaults", () => {
  it("reserves fable (never a default) and uses opus/xhigh for every work status", () => {
    const models = LAUNCHABLE_STATUSES.map((s) => BUILTIN_STAGE_DEFAULTS[s].model);
    expect(models).not.toContain("fable");
    expect(BUILTIN_STAGE_DEFAULTS["Backlog"]).toEqual({ model: "opus", effort: "xhigh" });
    expect(BUILTIN_STAGE_DEFAULTS["Todo"]).toEqual({ model: "opus", effort: "xhigh" });
    expect(BUILTIN_STAGE_DEFAULTS["In Progress"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("resolvers", () => {
  it("returns the built-in when there is no override", () => {
    expect(resolveModel("In Progress")).toBe("opus");
    expect(resolveEffort("In Progress")).toBe("xhigh");
  });
  it("prefers an override over the built-in", () => {
    const ov = { "In Progress": { model: "fable", effort: "max" as const } };
    expect(resolveModel("In Progress", ov)).toBe("fable");
    expect(resolveEffort("In Progress", ov)).toBe("max");
  });
  it("falls back to opus/high for an unknown status", () => {
    expect(resolveModel("Whatever")).toBe("opus");
    expect(resolveEffort("Whatever")).toBe("high");
  });
});

describe("mergeEffective", () => {
  it("returns one entry per launchable status, overrides layered on built-ins", () => {
    const eff = mergeEffective({ "In Progress": { model: "opus", effort: "medium" } });
    expect(Object.keys(eff).sort()).toEqual([...LAUNCHABLE_STATUSES].sort());
    expect(eff["In Progress"]).toEqual({ model: "opus", effort: "medium" });
    expect(eff["Todo"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("STAGE_DEFAULT_ROWS", () => {
  it("groups Backlog/Todo/In Progress into one row and covers every launchable status once", () => {
    expect(STAGE_DEFAULT_ROWS[0]).toEqual({ label: "Work (Backlog/Todo/In Progress)", statuses: ["Backlog", "Todo", "In Progress"] });
    const flat = STAGE_DEFAULT_ROWS.flatMap((r) => r.statuses).sort();
    expect(flat).toEqual([...LAUNCHABLE_STATUSES].sort());
  });
});

describe("validateStageDefaults", () => {
  it("accepts a valid partial map", () => {
    const r = validateStageDefaults({ "In Progress": { model: "sonnet", effort: "high" } });
    expect(r.ok).toBe(true);
  });
  it("rejects an unknown status key", () => {
    expect(validateStageDefaults({ "Nope": { model: "opus", effort: "high" } }).ok).toBe(false);
  });
  it("rejects an invalid model", () => {
    expect(validateStageDefaults({ "In Progress": { model: "gpt", effort: "high" } }).ok).toBe(false);
  });
  it("rejects an invalid effort", () => {
    expect(validateStageDefaults({ "In Progress": { model: "opus", effort: "ultra" } }).ok).toBe(false);
  });
  it("rejects a non-object", () => {
    expect(validateStageDefaults(null).ok).toBe(false);
    expect(validateStageDefaults([]).ok).toBe(false);
  });
});

describe("sanitizeOverrides", () => {
  it("keeps only entries with a known status, valid model, and valid effort", () => {
    const r = sanitizeOverrides({
      "In Progress": { model: "gpt", effort: "ultra" }, // invalid model + effort -> dropped
      "Todo": { model: "opus", effort: "medium" }, // valid -> kept
      "Nope": { model: "opus", effort: "high" }, // unknown status -> dropped
    });
    expect(r).toEqual({ "Todo": { model: "opus", effort: "medium" } });
  });
  it("returns {} for a non-object, null, or array", () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides([])).toEqual({});
    expect(sanitizeOverrides("nope")).toEqual({});
    expect(sanitizeOverrides(42)).toEqual({});
  });
});

describe("minimalOverrides", () => {
  it("returns {} when the draft equals the built-ins", () => {
    expect(minimalOverrides(BUILTIN_STAGE_DEFAULTS)).toEqual({});
  });
  it("keeps only the entries that differ from the built-ins", () => {
    const draft = { ...BUILTIN_STAGE_DEFAULTS, "Todo": { model: "opus", effort: "medium" as const } };
    expect(minimalOverrides(draft)).toEqual({ "Todo": { model: "opus", effort: "medium" } });
  });
});
