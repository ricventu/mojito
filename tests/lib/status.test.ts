import { describe, it, expect } from "vitest";
import { KNOWN_STATUSES } from "@/server/autoAdvance";
import { STATUS_ORDER, STATUS_COLOR, statusRank, statusColorClass, CUSTOM_STATUS, TERMINAL_STATUS } from "@/lib/status";

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
