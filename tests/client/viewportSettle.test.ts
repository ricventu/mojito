import { describe, it, expect } from "vitest";
import { keepSettling, SETTLE_MAX_PASSES } from "@/lib/viewportSettle";

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
