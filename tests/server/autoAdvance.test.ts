import { describe, it, expect } from "vitest";
import { GATE_STATES, TERMINAL_STATES, KNOWN_STATUSES, stageOf } from "@/server/autoAdvance";

describe("stageOf", () => {
  it("maps each lifecycle status to its stage number", () => {
    expect(stageOf("Backlog")).toBe(1);
    expect(stageOf("Todo")).toBe(1);
    expect(stageOf("To Code")).toBe(2);
    expect(stageOf("To Review")).toBe(3);
    expect(stageOf("To QA")).toBe(4);
    expect(stageOf("To Merge")).toBe(5);
    expect(stageOf("Done")).toBe(6);
  });
  it("is undefined for a status outside the known workflow", () => {
    expect(stageOf("Custom")).toBeUndefined();
  });
});

describe("KNOWN_STATUSES", () => {
  it("lists every status stageOf recognizes", () => {
    for (const name of KNOWN_STATUSES) expect(stageOf(name)).toBeDefined();
  });
});

describe("GATE_STATES / TERMINAL_STATES", () => {
  it("gate states are the human-decision statuses", () => {
    expect(GATE_STATES).toEqual(["To QA", "To Merge"]);
  });
  it("terminal states are the statuses that end the lifecycle", () => {
    expect(TERMINAL_STATES).toEqual(["Done", "Canceled", "Duplicate"]);
  });
});
