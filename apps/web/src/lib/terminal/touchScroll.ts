/**
 * Convert an accumulated vertical touch-drag (in pixels) into a whole number of
 * terminal rows to scroll, returning the leftover pixels to carry forward.
 *
 * Sign matches xterm's `Terminal.scrollLines`: positive scrolls down (toward the
 * present), negative scrolls up (into history). The caller accumulates
 * `previousClientY - currentClientY`, so an upward drag yields a positive value.
 */
export function computeTouchScroll(
  accumulatedPx: number,
  rowHeightPx: number,
): { lines: number; remainderPx: number } {
  if (rowHeightPx <= 0) return { lines: 0, remainderPx: 0 };
  const lines = Math.trunc(accumulatedPx / rowHeightPx);
  const remainderPx = accumulatedPx - lines * rowHeightPx;
  return { lines, remainderPx };
}

/**
 * Encode a line count as SGR mouse wheel events (mode 1006) to forward to the
 * pty. Claude's TUI runs in the alternate screen buffer (no xterm scrollback),
 * so scrolling means feeding it the same wheel events a real trackpad would:
 * xterm translates a wheel gesture into these sequences when the app has mouse
 * tracking on, and Claude scrolls its own transcript in response.
 *
 * Sign matches `computeTouchScroll`: a negative count scrolls up into history
 * (wheel-up, button 64); a positive count scrolls down toward the present
 * (wheel-down, button 65). One event per line; position is irrelevant for wheel
 * events so a fixed 1;1 cell is used.
 */
export function wheelSequences(lines: number): string {
  if (!Number.isFinite(lines)) return "";
  const count = Math.abs(Math.trunc(lines));
  if (count === 0) return "";
  const button = lines < 0 ? 64 : 65;
  return `\x1b[<${button};1;1M`.repeat(count);
}
