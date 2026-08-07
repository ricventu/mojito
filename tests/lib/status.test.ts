import { describe, it, expect } from "vitest";
import { KNOWN_STATUSES } from "@/server/statusModel";
import { STATUS_ORDER, STATUS_COLOR, statusRank, statusColorClass, CUSTOM_STATUS, TERMINAL_STATUS } from "@/lib/status";

describe("status metadata", () => {
  it("covers exactly the statuses the server model knows — nothing missing, nothing extra", () => {
    const known = new Set(KNOWN_STATUSES);
    expect(new Set(Object.keys(STATUS_ORDER))).toEqual(known);
    expect(new Set(Object.keys(STATUS_COLOR))).toEqual(known);
  });

  it("assigns a unique rank to each status", () => {
    const ranks = Object.values(STATUS_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("orders the lifecycle Backlog → Duplicate", () => {
    expect(statusRank("Backlog")).toBeLessThan(statusRank("In Progress"));
    expect(statusRank("In Progress")).toBeLessThan(statusRank("Done"));
    expect(statusRank("Done")).toBeLessThan(statusRank("Duplicate"));
  });

  it("sorts unknown statuses last and colors them muted", () => {
    expect(statusRank("Whatever")).toBe(Number.MAX_SAFE_INTEGER);
    expect(statusRank("Whatever")).toBeGreaterThan(statusRank("Duplicate"));
    expect(statusColorClass("Whatever")).toBe("muted");
  });

  it("returns the mapped color for a known status", () => {
    expect(statusColorClass("In Progress")).toBe("blue");
    expect(statusColorClass("Done")).toBe("green");
  });

  it("gives the custom and terminal buckets their own distinct hues", () => {
    expect(statusColorClass(CUSTOM_STATUS)).toBe("pink");
    expect(statusColorClass(TERMINAL_STATUS)).toBe("term");
    expect(statusColorClass(CUSTOM_STATUS)).not.toBe(statusColorClass(TERMINAL_STATUS));
  });

  it("only uses hues that have a matching badge CSS rule", () => {
    const ALLOWED_HUES = new Set(["grey", "blue", "indigo", "amber", "teal", "green", "red", "muted"]);
    for (const hue of Object.values(STATUS_COLOR)) {
      expect(ALLOWED_HUES, `hue ${hue}`).toContain(hue);
    }
  });
});
