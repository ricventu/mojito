import { describe, it, expect } from "vitest";
import { isUsableGeometry, MIN_COLS, MIN_ROWS } from "@/lib/terminalFit";

describe("isUsableGeometry", () => {
  it("accepts a normal phone geometry (keyboard open)", () => {
    expect(isUsableGeometry({ cols: 49, rows: 13 })).toBe(true);
  });

  it("accepts a desktop geometry", () => {
    expect(isUsableGeometry({ cols: 120, rows: 48 })).toBe(true);
  });

  // Measured in a real browser: as the visible band shrinks, FitAddon's proposal
  // collapses (a 200px band yields 1 row, since xterm clamps to its minimum).
  // Propagating that to the pty resizes the tmux window to one row, and the TUI
  // can no longer draw its input line.
  it("rejects the collapsed geometry a shrinking viewport produces", () => {
    expect(isUsableGeometry({ cols: 51, rows: 1 })).toBe(false);
    expect(isUsableGeometry({ cols: 51, rows: 2 })).toBe(false);
  });

  it("rejects a degenerate or missing proposal", () => {
    expect(isUsableGeometry({ cols: 0, rows: 0 })).toBe(false);
    expect(isUsableGeometry({ cols: 49, rows: 0 })).toBe(false);
    expect(isUsableGeometry({ cols: 49, rows: -1 })).toBe(false);
    expect(isUsableGeometry({ cols: NaN, rows: 13 })).toBe(false);
    expect(isUsableGeometry(undefined)).toBe(false);
  });

  it("puts the floor low enough to keep a genuinely small terminal usable", () => {
    expect(MIN_ROWS).toBeLessThanOrEqual(8);
    expect(MIN_COLS).toBeLessThanOrEqual(24);
    expect(isUsableGeometry({ cols: MIN_COLS, rows: MIN_ROWS })).toBe(true);
  });
});
