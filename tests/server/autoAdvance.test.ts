import { describe, it, expect } from "vitest";
import { decideAutoAdvance, stageAdvanced } from "@/server/autoAdvance";

describe("stageAdvanced", () => {
  it("is false within the same stage (Planned and In Progress are both Stage 2)", () => {
    // Stage 2 sets the ticket to In Progress on itself; that is intra-stage
    // progress, NOT a handoff, and must not trigger a successor launch.
    expect(stageAdvanced("Planned", "In Progress")).toBe(false);
    expect(stageAdvanced("In Progress", "In Progress")).toBe(false);
  });
  it("is true when moving to a later stage", () => {
    expect(stageAdvanced("Planned", "To Review")).toBe(true);
    expect(stageAdvanced("In Progress", "To Review")).toBe(true);
    expect(stageAdvanced("Todo", "Planned")).toBe(true);
    expect(stageAdvanced("To Review", "To QA")).toBe(true);
  });
  it("is false when the status is unchanged", () => {
    expect(stageAdvanced("Planned", "Planned")).toBe(false);
  });
  it("falls back to raw inequality for statuses outside the known workflow", () => {
    expect(stageAdvanced("Planned", "Custom")).toBe(true);
    expect(stageAdvanced("Custom", "Custom")).toBe(false);
  });
});

describe("decideAutoAdvance", () => {
  it("stops when the toggle is off", () => {
    expect(decideAutoAdvance("In Progress", false)).toEqual({ action: "stop" });
  });
  it("stops at terminal states", () => {
    expect(decideAutoAdvance("Done", true)).toEqual({ action: "stop" });
  });
  it("gates at human-decision states", () => {
    expect(decideAutoAdvance("To QA", true)).toEqual({ action: "gate", gate: "To QA" });
    expect(decideAutoAdvance("To Merge", true)).toEqual({ action: "gate", gate: "To Merge" });
  });
  it("launches otherwise", () => {
    expect(decideAutoAdvance("Planned", true)).toEqual({ action: "launch" });
  });
});
