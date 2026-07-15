import { describe, it, expect } from "vitest";
import { computeTouchScroll, wheelSequences } from "@/lib/touchScroll";

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

describe("wheelSequences", () => {
  const UP = "\x1b[<64;1;1M"; // into history
  const DOWN = "\x1b[<65;1;1M"; // toward present

  it("emits nothing for zero lines", () => {
    expect(wheelSequences(0)).toBe("");
  });

  it("maps a negative (scroll-up) line count to wheel-up events", () => {
    expect(wheelSequences(-1)).toBe(UP);
  });

  it("maps a positive (scroll-down) line count to wheel-down events", () => {
    expect(wheelSequences(1)).toBe(DOWN);
  });

  it("repeats one wheel event per line", () => {
    expect(wheelSequences(-3)).toBe(UP.repeat(3));
    expect(wheelSequences(2)).toBe(DOWN.repeat(2));
  });

  it("ignores non-finite input", () => {
    expect(wheelSequences(Number.NaN)).toBe("");
    expect(wheelSequences(Number.POSITIVE_INFINITY)).toBe("");
  });
});
