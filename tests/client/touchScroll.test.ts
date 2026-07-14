import { describe, it, expect } from "vitest";
import { computeTouchScroll } from "@/lib/touchScroll";

describe("computeTouchScroll", () => {
  it("returns zero lines and carries a sub-row drag as remainder", () => {
    expect(computeTouchScroll(10, 18)).toEqual({ lines: 0, remainderPx: 10 });
  });

  it("converts an upward-drag accumulator to a positive (scroll-down) line count", () => {
    expect(computeTouchScroll(20, 18)).toEqual({ lines: 1, remainderPx: 2 });
  });

  it("converts a downward-drag accumulator to a negative (scroll-up) line count", () => {
    expect(computeTouchScroll(-20, 18)).toEqual({ lines: -1, remainderPx: -2 });
  });

  it("truncates multiple rows and carries the remainder", () => {
    expect(computeTouchScroll(50, 18)).toEqual({ lines: 2, remainderPx: 14 });
  });

  it("guards against a zero or negative row height", () => {
    expect(computeTouchScroll(100, 0)).toEqual({ lines: 0, remainderPx: 0 });
    expect(computeTouchScroll(100, -5)).toEqual({ lines: 0, remainderPx: 0 });
  });
});
