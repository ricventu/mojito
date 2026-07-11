import { describe, it, expect } from "vitest";
import { decideAutoAdvance } from "@/server/autoAdvance";

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
