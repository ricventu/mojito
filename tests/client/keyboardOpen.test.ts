import { describe, it, expect } from "vitest";
import { isKeyboardOpen } from "@/lib/keyboardInset";

// Measured on the real CSS at a 380px band (iPhone, keyboard up): Mojito's header
// (65px) plus the ticket title (55px, two lines at phone width) plus the key bar
// (54px) leave the pane 12 rows — and claude's TUI needs ~17 for this session's
// recap and todo panel, so it drops its input line. Hiding the header and title
// while the keyboard is up buys back 8 rows. Detection is by how much the visual
// viewport has shrunk against the layout viewport, which is what iOS reports.
describe("isKeyboardOpen", () => {
  it("is closed when the visual viewport matches the layout viewport", () => {
    expect(isKeyboardOpen({ layoutHeight: 896, visualHeight: 896 })).toBe(false);
  });

  it("is open when the keyboard has taken a large bite out of the viewport", () => {
    expect(isKeyboardOpen({ layoutHeight: 896, visualHeight: 380 })).toBe(true);
  });

  it("ignores Safari's own toolbars collapsing (a small delta)", () => {
    expect(isKeyboardOpen({ layoutHeight: 896, visualHeight: 846 })).toBe(false);
    expect(isKeyboardOpen({ layoutHeight: 896, visualHeight: 800 })).toBe(false);
  });

  it("treats a missing or nonsensical measurement as closed", () => {
    expect(isKeyboardOpen({ layoutHeight: 0, visualHeight: 0 })).toBe(false);
    expect(isKeyboardOpen({ layoutHeight: 896, visualHeight: NaN })).toBe(false);
    // A visual viewport taller than the layout one is not a keyboard.
    expect(isKeyboardOpen({ layoutHeight: 380, visualHeight: 896 })).toBe(false);
  });
});
