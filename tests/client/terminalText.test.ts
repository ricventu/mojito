import { describe, it, expect } from "vitest";
import { bufferText, type BufferLike, type BufferLineLike } from "@/lib/terminalText";

/**
 * A fake buffer line, faithful to the one thing about xterm's own that matters
 * here: `trimRight` trims **only cells that were never written**
 * (`getTrimmedLength` stops at the last cell with `HAS_CONTENT_MASK`, and a
 * space character is content). tmux paints its pane with real spaces, so a
 * row's right-hand padding survives `translateToString(true)` — which is the
 * bug this fake used to hide by trimming with a regex of its own.
 *
 * So: `text` is what the app wrote, kept verbatim. `blankCells` is the tail of
 * never-written cells after it, which is what `trimRight` may drop.
 */
function line(text: string, isWrapped = false, blankCells = 0): BufferLineLike {
  const nulls = " ".repeat(blankCells);
  return {
    isWrapped,
    translateToString: (trimRight?: boolean) => (trimRight ? text : text + nulls),
  };
}

/** `rows` positionally; a `null` stands for a line xterm has no record of. */
function buffer(rows: (BufferLineLike | null)[]): BufferLike {
  return { length: rows.length, getLine: (y) => rows[y] ?? undefined };
}

describe("bufferText", () => {
  it("is empty for a buffer with no lines", () => {
    expect(bufferText(buffer([]))).toBe("");
  });

  it("is empty for a buffer holding nothing but blank rows", () => {
    // "   " is a row tmux painted with real spaces: blank to a reader, content
    // as far as xterm is concerned.
    expect(bufferText(buffer([line(""), line("   "), line("")]))).toBe("");
  });

  it("joins rows with newlines", () => {
    expect(bufferText(buffer([line("first"), line("second")]))).toBe("first\nsecond");
  });

  it("trims the padding off the right of a row", () => {
    // Every row is `cols` cells wide, so all but the longest carry trailing
    // blanks. Copying them would paste a rectangle of spaces — and worse, a
    // line padded to `cols` re-wraps wherever it is pasted, which reads as the
    // copy having invented line breaks.
    //
    // These are spaces tmux *wrote*, so xterm keeps them: `trimRight` only
    // drops never-written cells. Trimming them is this module's job.
    expect(bufferText(buffer([line("claude   ")]))).toBe("claude");
    expect(bufferText(buffer([line("claude", false, 44)]))).toBe("claude");
  });

  it("drops the blank rows at the top and bottom but keeps the ones between", () => {
    // A TUI leaves whole bands of empty rows — above its box, and below its
    // input line. The blank line inside the output is the author's, not padding.
    const rows = [line(""), line("one"), line(""), line("two"), line(""), line("")];
    expect(bufferText(buffer(rows))).toBe("one\n\ntwo");
  });

  it("joins a wrapped row onto the row it continues, without a newline", () => {
    // The reason for copying at all is usually a path or a URL, which is
    // exactly what a terminal breaks across rows. A newline in the middle of
    // one makes the paste useless.
    const rows = [line("/Users/ric/code/very/long"), line("/path/to/file.ts", true)];
    expect(bufferText(buffer(rows))).toBe("/Users/ric/code/very/long/path/to/file.ts");
  });

  it("keeps the spaces at the end of a row that its next row continues", () => {
    // Trimming here would eat a space that is part of the text, not padding:
    // the row is full, so there is no padding to trim.
    const rows = [line("git commit -m "), line("'msg'", true)];
    expect(bufferText(buffer(rows))).toBe("git commit -m 'msg'");
  });

  it("joins a run of three wrapped rows into one line", () => {
    const rows = [line("aaa"), line("bbb", true), line("ccc", true), line("ddd")];
    expect(bufferText(buffer(rows))).toBe("aaabbbccc\nddd");
  });

  it("starts a line on a wrapped row with nothing before it", () => {
    // The first row of the buffer can be marked wrapped: its predecessor has
    // been scrolled out of the scrollback. There is nothing to join it to.
    expect(bufferText(buffer([line("tail of a line", true), line("next")]))).toBe("tail of a line\nnext");
  });

  it("leaves no row padded to the pane width", () => {
    // The shape of the bug as it was reported: every row of a 20-column pane
    // came out padded to 20, so the paste re-wrapped at every line and looked
    // like it had invented breaks. tmux writes those spaces; xterm keeps them.
    const rows = [line("a note".padEnd(20)), line("across two rows".padEnd(20))];
    expect(bufferText(buffer(rows))).toBe("a note\nacross two rows");
  });

  it("trims the end of a joined line but not the seam inside it", () => {
    const rows = [line("git commit -m "), line("'msg'   ", true)];
    expect(bufferText(buffer(rows))).toBe("git commit -m 'msg'");
  });

  it("treats a line xterm has no record of as blank", () => {
    expect(bufferText(buffer([line("one"), null, line("two")]))).toBe("one\n\ntwo");
  });
});
