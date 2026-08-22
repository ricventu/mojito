import { describe, it, expect } from "vitest";
import { composerHeight } from "@/lib/composerHeight";

// A 20px line of text in a box with 8px padding and a 1px border on each side.
const box = { lineHeight: 20, verticalPadding: 16, verticalBorder: 2, maxLines: 5 };

describe("composerHeight", () => {
  it("hands back the measured height while the draft fits under the cap", () => {
    expect(composerHeight({ ...box, scrollHeight: 76 })).toBe(78);
  });

  it("adds the border, which scrollHeight leaves out and border-box counts in", () => {
    // Everything is `box-sizing: border-box` (globals.css), so the height we set
    // has to cover the border — but scrollHeight measures content plus padding
    // only. Skip this and the field sits 2px short of its own text, which iOS
    // answers with a scrollbar over a single line of it.
    expect(composerHeight({ ...box, verticalBorder: 0, scrollHeight: 76 })).toBe(76);
  });

  it("caps a long draft at maxLines so it scrolls instead of eating the terminal", () => {
    // The composer grows into `.term-body`, and while the keyboard is up the
    // whole visible band is ~13 rows (keyboardInset.ts). An uncapped field would
    // push claude's input line off the top of it.
    expect(composerHeight({ ...box, scrollHeight: 400 })).toBe(118);
  });

  it("never returns less than a single line", () => {
    // iOS measures a freshly revealed textarea at 0 often enough to matter: the
    // reveal, the autoFocus and the keyboard animation all land in the same
    // frame. Collapsing the field to nothing there would hide the caret the
    // space-hold gesture is supposed to move.
    expect(composerHeight({ ...box, scrollHeight: 0 })).toBe(38);
  });

  it("rounds a subpixel measurement up so no scrollbar appears over one line", () => {
    expect(composerHeight({ ...box, scrollHeight: 56.4 })).toBe(59);
  });

  it("declines to answer when the box cannot be measured yet", () => {
    // `getComputedStyle(el).lineHeight` is the string "normal" until the font
    // metrics resolve, and parseFloat makes that NaN. Answering anyway would pin
    // the field to a number derived from nothing; null tells the caller to leave
    // the CSS min-height in charge for this pass.
    expect(composerHeight({ ...box, lineHeight: NaN, scrollHeight: 76 })).toBeNull();
    expect(composerHeight({ ...box, lineHeight: 0, scrollHeight: 76 })).toBeNull();
  });
});
