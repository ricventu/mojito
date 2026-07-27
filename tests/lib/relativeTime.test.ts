import { describe, it, expect } from "vitest";
import { relativeTime } from "@/lib/relativeTime";

// Local time throughout: the viewer reads these next to a file name on a phone.
const now = new Date(2026, 6, 27, 16, 30); // 27 Jul 2026, 16:30 local

describe("relativeTime", () => {
  it("shows the clock time for today", () => {
    expect(relativeTime(new Date(2026, 6, 27, 14, 21).toISOString(), now)).toBe("14:21");
  });

  it("pads single-digit hours and minutes", () => {
    expect(relativeTime(new Date(2026, 6, 27, 9, 5).toISOString(), now)).toBe("09:05");
  });

  it("says yesterday", () => {
    expect(relativeTime(new Date(2026, 6, 26, 23, 0).toISOString(), now)).toBe("yesterday");
  });

  it("counts days within the week", () => {
    expect(relativeTime(new Date(2026, 6, 24, 8, 0).toISOString(), now)).toBe("3 days");
    expect(relativeTime(new Date(2026, 6, 21, 8, 0).toISOString(), now)).toBe("6 days");
  });

  it("falls back to a day and month beyond a week", () => {
    expect(relativeTime(new Date(2026, 6, 12, 8, 0).toISOString(), now)).toBe("12 Jul");
    expect(relativeTime(new Date(2026, 0, 3, 8, 0).toISOString(), now)).toBe("3 Jan");
  });

  it("shows the clock time for a future stamp rather than negative days", () => {
    expect(relativeTime(new Date(2026, 6, 28, 10, 0).toISOString(), now)).toBe("10:00");
  });

  it("is empty for an unparseable value", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});
