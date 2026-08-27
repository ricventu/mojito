import { describe, it, expect } from "vitest";
import { isUsableGeometry, syncGeometry, MIN_COLS, MIN_ROWS } from "@/lib/terminalFit";

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

describe("syncGeometry", () => {
  const spy = (over: Partial<Parameters<typeof syncGeometry>[0]> = {}) => {
    const calls = { proposed: 0, refit: 0, send: 0 };
    const input = {
      keyboardOpen: false,
      propose: () => {
        calls.proposed += 1;
        return { cols: 55, rows: 54 };
      },
      refit: () => {
        calls.refit += 1;
      },
      send: () => {
        calls.send += 1;
      },
      ...over,
    };
    syncGeometry(input);
    return calls;
  };

  it("re-fits and publishes when the box is one we trust", () => {
    expect(spy()).toEqual({ proposed: 1, refit: 1, send: 1 });
  });

  // The two guards below gate the *fit* only. The pty must still be told what the
  // terminal's geometry is: `sendResize` is the client's one channel for it, and a
  // socket that (re)connects while a guard holds spawns its `tmux attach` at the
  // gateway's 80x24 default with nothing left to correct it (RIC-258).
  it("still publishes the geometry while the keyboard is up", () => {
    expect(spy({ keyboardOpen: true })).toMatchObject({ refit: 0, send: 1 });
  });

  it("still publishes the geometry for a band the keyboard is passing through", () => {
    expect(spy({ propose: () => ({ cols: 51, rows: 1 }) })).toMatchObject({ refit: 0, send: 1 });
  });

  it("does not measure the box at all while the keyboard is up", () => {
    expect(spy({ keyboardOpen: true }).proposed).toBe(0);
  });
});
