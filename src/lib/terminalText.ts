/**
 * Reads the terminal's buffer back out as plain text, for a surface a phone can
 * actually select from.
 *
 * **Why this exists at all.** Nothing in the terminal itself can be selected on
 * a phone, and every reason is independent of the others:
 *
 * - claude's TUI turns on mouse tracking, so xterm disables its own selection
 *   service for the duration (see `terminalOptions.ts` — the Mac's way back in
 *   is Option+drag, and there is no touch equivalent of holding a modifier);
 * - a touch drag produces no mouse events for that service to read even when it
 *   is enabled, and Mojito's own capture-phase `touchmove` handler plus
 *   `.term-root .xterm { touch-action: none }` turn every drag into a scroll;
 * - native browser selection is off regardless: xterm.css sets
 *   `.xterm { user-select: none }` and xterm's always-on `mousedown` listener
 *   calls `preventDefault()` unconditionally;
 * - and since RIC-239 the rows are a WebGL canvas, so there is no DOM text to
 *   long-press in the first place.
 *
 * Going back to the DOM renderer fixes none of the first three. So the fix is
 * the one the composer already established in the other direction: **give iOS
 * a real text surface** and let its own long-press → "Copia" do the work. That
 * matters twice over here, because Mojito is served over plain http
 * (`server.ts`), and outside a secure context `navigator.clipboard` does not
 * exist — a "copy to clipboard" button could not work from a phone at all.
 * Native selection needs no API.
 *
 * The pure half of the usual split (cf. `resolveInitialToken` ÷ `useToken`):
 * the buffer is structural, so this is testable in the node-only vitest setup
 * with no xterm and no DOM.
 */

/** Just the half of xterm's `IBufferLine` this reads. */
export interface BufferLineLike {
  /** True when this row is the continuation of the row above it. */
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

/** Just the half of xterm's `IBuffer` this reads. */
export interface BufferLike {
  readonly length: number;
  getLine(y: number): BufferLineLike | undefined;
}

const isBlank = (s: string) => s.trim().length === 0;

/**
 * The whole active buffer as text: rows joined by newlines, wrapped rows joined
 * to what they continue, and the blank rows at either end dropped.
 *
 * `length` covers the scrollback too, which is deliberate and needs no branch:
 * the alternate screen buffer (claude's TUI, and anything else full-screen) has
 * none, so there it is exactly the visible screen; a plain shell session gets
 * its history as well, which is the output most worth copying.
 *
 * Blank rows are trimmed only at the ends. A TUI leaves whole bands of them —
 * above its box, and below its input line — but a blank line *between* two
 * lines of output is the author's and is kept.
 */
export function bufferText(buffer: BufferLike): string {
  const rows: (BufferLineLike | undefined)[] = [];
  for (let y = 0; y < buffer.length; y++) rows.push(buffer.getLine(y));

  const lines: string[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    // Trim this row's right-hand padding — unless the next row continues it, in
    // which case this one is full to the last cell and any trailing space is
    // part of the text rather than padding.
    const continued = rows[y + 1]?.isWrapped === true;
    const text = row ? row.translateToString(!continued) : "";
    // A wrapped first row has had its predecessor scrolled out of the
    // scrollback: there is nothing to join it to, so it starts a line.
    if (row?.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }

  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start])) start += 1;
  while (end > start && isBlank(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join("\n");
}
