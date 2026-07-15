import { describe, it, expect } from "vitest";
import { decideAutoAdvance, defaultEffortForStatus, stageAdvanced } from "@/server/autoAdvance";

describe("stageAdvanced", () => {
  it("is true when moving to a later stage", () => {
    expect(stageAdvanced("Todo", "To Code")).toBe(true);
    expect(stageAdvanced("To Code", "To Review")).toBe(true);
    expect(stageAdvanced("To Review", "To QA")).toBe(true);
  });
  it("is false when the status is unchanged", () => {
    expect(stageAdvanced("To Code", "To Code")).toBe(false);
  });
  it("is false for a same-stage move (Backlog and Todo are both stage 1)", () => {
    expect(stageAdvanced("Backlog", "Todo")).toBe(false);
    expect(stageAdvanced("Todo", "Backlog")).toBe(false);
  });
  it("is false on a backward move (QA reject sends To QA -> To Code)", () => {
    // Reject is a manual/GUI action; a stray Stop hook seeing the backward move
    // must not be read as a completed stage and relaunch Stage 2.
    expect(stageAdvanced("To QA", "To Code")).toBe(false);
  });
  it("falls back to raw inequality for statuses outside the known workflow", () => {
    expect(stageAdvanced("To Code", "Custom")).toBe(true);
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

describe("defaultEffortForStatus", () => {
  it("uses xhigh for the design stage (Backlog/Todo), where a bad plan poisons the pipeline", () => {
    expect(defaultEffortForStatus("Backlog")).toBe("xhigh");
    expect(defaultEffortForStatus("Todo")).toBe("xhigh");
  });
  it("uses high for implementation (To Code), where subagents do the heavy lifting", () => {
    expect(defaultEffortForStatus("To Code")).toBe("high");
  });
  it("uses xhigh for code review (To Review), an analytical read-only stage", () => {
    expect(defaultEffortForStatus("To Review")).toBe("xhigh");
  });
  it("uses low for the mechanical QA gate (To QA)", () => {
    expect(defaultEffortForStatus("To QA")).toBe("low");
  });
  it("uses medium for the procedural merge stage (To Merge)", () => {
    expect(defaultEffortForStatus("To Merge")).toBe("medium");
  });
  it("falls back to high for statuses outside the known workflow", () => {
    expect(defaultEffortForStatus("In Progress")).toBe("high");
    expect(defaultEffortForStatus("Done")).toBe("high");
  });
});
