import { describe, it, expect } from "vitest";
import { KNOWN_STATUSES } from "@/server/autoAdvance";
import { STATUS_ORDER, STATUS_COLOR, statusRank, statusColorClass } from "@/lib/status";

describe("status metadata", () => {
  it("covers every status the server model knows", () => {
    for (const name of KNOWN_STATUSES) {
      expect(STATUS_ORDER, `order for ${name}`).toHaveProperty(name);
      expect(STATUS_COLOR, `color for ${name}`).toHaveProperty(name);
    }
  });

  it("assigns a unique rank to each status", () => {
    const ranks = Object.values(STATUS_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("orders the lifecycle Backlog → Duplicate", () => {
    expect(statusRank("Backlog")).toBeLessThan(statusRank("To Code"));
    expect(statusRank("To Code")).toBeLessThan(statusRank("Done"));
    expect(statusRank("Done")).toBeLessThan(statusRank("Duplicate"));
  });

  it("sorts unknown statuses last and colors them muted", () => {
    expect(statusRank("Whatever")).toBe(Number.MAX_SAFE_INTEGER);
    expect(statusRank("Whatever")).toBeGreaterThan(statusRank("Duplicate"));
    expect(statusColorClass("Whatever")).toBe("muted");
  });

  it("returns the mapped color for a known status", () => {
    expect(statusColorClass("To Code")).toBe("blue");
    expect(statusColorClass("Done")).toBe("green");
  });
});
