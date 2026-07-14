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
