import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/git/time";

const now = Date.parse("2026-10-30T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;

describe("relativeTime", () => {
  it("uses seconds", () => expect(relativeTime(ago(30 * S), now)).toBe("30 seconds ago"));
  it("uses minutes", () => expect(relativeTime(ago(5 * MIN), now)).toBe("5 minutes ago"));
  it("uses hours", () => expect(relativeTime(ago(3 * H), now)).toBe("3 hours ago"));
  it("says yesterday for a day", () => expect(relativeTime(ago(D), now)).toBe("yesterday"));
  it("uses days", () => expect(relativeTime(ago(5 * D), now)).toBe("5 days ago"));
  it("says last month for 40 days", () => expect(relativeTime(ago(40 * D), now)).toBe("last month"));
  it("uses months", () => expect(relativeTime(ago(95 * D), now)).toBe("3 months ago"));
  it("uses years", () => expect(relativeTime(ago(2 * 365 * D), now)).toBe("2 years ago"));
  it("says now for the present", () => expect(relativeTime(ago(0), now)).toBe("now"));
  it("reads a date in the future", () => expect(relativeTime(ago(-5 * MIN), now)).toBe("in 5 minutes"));
  it("defaults now to the clock", () => {
    expect(relativeTime(new Date(Date.now() - 2 * H).toISOString())).toBe("2 hours ago");
  });
});
