import { describe, it, expect } from "vitest";
import { WORK_STATES, GATE_STATES, TERMINAL_STATES, KNOWN_STATUSES } from "@/server/statusModel";

describe("statusModel", () => {
  it("KNOWN_STATUSES is exactly the collapsed lifecycle, in order", () => {
    expect(KNOWN_STATUSES).toEqual([
      "Backlog", "Todo", "In Progress", "To QA", "Done", "Canceled", "Duplicate",
    ]);
  });

  it("WORK_STATES are the pre-gate statuses", () => {
    expect(WORK_STATES).toEqual(["Backlog", "Todo", "In Progress"]);
  });

  it("GATE_STATES is only the To QA human-approval gate", () => {
    expect(GATE_STATES).toEqual(["To QA"]);
  });

  it("TERMINAL_STATES are the statuses that end the lifecycle", () => {
    expect(TERMINAL_STATES).toEqual(["Done", "Canceled", "Duplicate"]);
  });

  it("the three groups partition KNOWN_STATUSES with no overlap", () => {
    const groups = [WORK_STATES, GATE_STATES, TERMINAL_STATES];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const status of group) {
        expect(seen.has(status), `${status} appears in more than one group`).toBe(false);
        seen.add(status);
      }
    }
    expect(seen).toEqual(new Set(KNOWN_STATUSES));
  });
});
