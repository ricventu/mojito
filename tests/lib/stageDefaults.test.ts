import { describe, it, expect } from "vitest";
import {
  BUILTIN_STAGE_DEFAULTS, LAUNCHABLE_STATUSES, STAGE_DEFAULT_ROWS,
  resolveModel, resolveEffort, mergeEffective, validateStageDefaults,
  sanitizeOverrides, minimalOverrides,
} from "@/lib/stageDefaults";

describe("built-in seed defaults", () => {
  it("reserves fable (never a default) and uses sonnet only for the mechanical To QA gate", () => {
    const models = LAUNCHABLE_STATUSES.map((s) => BUILTIN_STAGE_DEFAULTS[s].model);
    expect(models).not.toContain("fable");
    expect(BUILTIN_STAGE_DEFAULTS["To QA"]).toEqual({ model: "sonnet", effort: "low" });
    expect(BUILTIN_STAGE_DEFAULTS["To Review"]).toEqual({ model: "opus", effort: "xhigh" });
    expect(BUILTIN_STAGE_DEFAULTS["To Code"]).toEqual({ model: "opus", effort: "high" });
    expect(BUILTIN_STAGE_DEFAULTS["Backlog"]).toEqual({ model: "opus", effort: "xhigh" });
    expect(BUILTIN_STAGE_DEFAULTS["To Merge"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("resolvers", () => {
  it("returns the built-in when there is no override", () => {
    expect(resolveModel("To QA")).toBe("sonnet");
    expect(resolveEffort("To Review")).toBe("xhigh");
  });
  it("prefers an override over the built-in", () => {
    const ov = { "To Review": { model: "fable", effort: "max" as const } };
    expect(resolveModel("To Review", ov)).toBe("fable");
    expect(resolveEffort("To Review", ov)).toBe("max");
  });
  it("falls back to opus/high for an unknown status", () => {
    expect(resolveModel("In Progress")).toBe("opus");
    expect(resolveEffort("In Progress")).toBe("high");
  });
});

describe("mergeEffective", () => {
  it("returns one entry per launchable status, overrides layered on built-ins", () => {
    const eff = mergeEffective({ "To QA": { model: "opus", effort: "medium" } });
    expect(Object.keys(eff).sort()).toEqual([...LAUNCHABLE_STATUSES].sort());
    expect(eff["To QA"]).toEqual({ model: "opus", effort: "medium" });
    expect(eff["To Review"]).toEqual({ model: "opus", effort: "xhigh" });
  });
});

describe("STAGE_DEFAULT_ROWS", () => {
  it("groups Backlog and Todo into one row and covers every launchable status once", () => {
    expect(STAGE_DEFAULT_ROWS[0]).toEqual({ label: "Backlog/Todo", statuses: ["Backlog", "Todo"] });
    const flat = STAGE_DEFAULT_ROWS.flatMap((r) => r.statuses).sort();
    expect(flat).toEqual([...LAUNCHABLE_STATUSES].sort());
  });
});

describe("validateStageDefaults", () => {
  it("accepts a valid partial map", () => {
    const r = validateStageDefaults({ "To Code": { model: "sonnet", effort: "high" } });
    expect(r.ok).toBe(true);
  });
  it("rejects an unknown status key", () => {
    expect(validateStageDefaults({ "Nope": { model: "opus", effort: "high" } }).ok).toBe(false);
  });
  it("rejects an invalid model", () => {
    expect(validateStageDefaults({ "To Code": { model: "gpt", effort: "high" } }).ok).toBe(false);
  });
  it("rejects an invalid effort", () => {
    expect(validateStageDefaults({ "To Code": { model: "opus", effort: "ultra" } }).ok).toBe(false);
  });
  it("rejects a non-object", () => {
    expect(validateStageDefaults(null).ok).toBe(false);
    expect(validateStageDefaults([]).ok).toBe(false);
  });
});

describe("sanitizeOverrides", () => {
  it("keeps only entries with a known status, valid model, and valid effort", () => {
    const r = sanitizeOverrides({
      "To Review": { model: "gpt", effort: "ultra" }, // invalid model + effort -> dropped
      "To QA": { model: "opus", effort: "medium" }, // valid -> kept
      "Nope": { model: "opus", effort: "high" }, // unknown status -> dropped
    });
    expect(r).toEqual({ "To QA": { model: "opus", effort: "medium" } });
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
    const draft = { ...BUILTIN_STAGE_DEFAULTS, "To QA": { model: "opus", effort: "medium" as const } };
    expect(minimalOverrides(draft)).toEqual({ "To QA": { model: "opus", effort: "medium" } });
  });
});
