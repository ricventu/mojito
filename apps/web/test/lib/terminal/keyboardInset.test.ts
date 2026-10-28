import { describe, it, expect } from "vitest";
import { keepSettling, SETTLE_MAX_PASSES, termRootStyle } from "@/lib/terminal/keyboardInset";

describe("termRootStyle", () => {
  it("keyboard closed: fills the full viewport with no offset", () => {
    expect(termRootStyle({ height: 844, offsetTop: 0 })).toEqual({
      height: "844px",
      transform: "translateY(0px)",
    });
  });

  it("keyboard open: shrinks height to the visible band", () => {
    expect(termRootStyle({ height: 500, offsetTop: 0 })).toEqual({
      height: "500px",
      transform: "translateY(0px)",
    });
  });

  it("offset visual viewport: shifts the fixed container down to the visible top", () => {
    expect(termRootStyle({ height: 500, offsetTop: 40 })).toEqual({
      height: "500px",
      transform: "translateY(40px)",
    });
  });

  it("rounds fractional metrics to whole pixels", () => {
    expect(termRootStyle({ height: 499.6, offsetTop: 12.3 })).toEqual({
      height: "500px",
      transform: "translateY(12px)",
    });
  });

  it("clamps negative metrics to zero", () => {
    expect(termRootStyle({ height: -10, offsetTop: -5 })).toEqual({
      height: "0px",
      transform: "translateY(0px)",
    });
  });
});

// iOS delivers the keyboard as a run of visualViewport resizes and the band is
// still moving when the last one arrives — observed live: the pane ended up 32
// rows while only ~29 were visible, so the TUI's input box fell below the fold.
// Re-fitting alone cannot fix that: the band has to be re-read until it stops
// moving, because no further event may come to correct a mid-animation value.
describe("keepSettling", () => {
  it("keeps going while the band is still moving", () => {
    expect(keepSettling({ band: 534, lastBand: 380, passes: 1 })).toBe(true);
  });

  it("stops once the band has stopped moving", () => {
    expect(keepSettling({ band: 490, lastBand: 490, passes: 1 })).toBe(false);
  });

  it("always takes at least one look after the first pass", () => {
    expect(keepSettling({ band: 490, lastBand: -1, passes: 0 })).toBe(true);
  });

  it("gives up rather than re-arming forever", () => {
    expect(keepSettling({ band: 100, lastBand: 200, passes: SETTLE_MAX_PASSES })).toBe(false);
    expect(keepSettling({ band: 100, lastBand: 200, passes: SETTLE_MAX_PASSES - 1 })).toBe(true);
  });
});
