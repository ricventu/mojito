/**
 * Guard for the geometry the browser terminal propagates to the pty.
 *
 * The mobile keyboard does not resize the visible band in one step: iOS fires a
 * run of `visualViewport` resize events while it animates, and the intermediate
 * bands are tiny. FitAddon proposes a row count for whatever it measures, and
 * xterm clamps it to its own minimum — measured in a real browser, a 200px band
 * yields **1 row**. Sending that on is destructive: tmux resizes the window to
 * one row, the TUI can no longer draw its input line, and every row the pane no
 * longer owns keeps whatever was on screen before. Because the client only
 * re-sends geometry when another viewport event happens, a degenerate value that
 * lands last simply sticks — the terminal stays mismatched with what the user
 * can see (input line missing, stale rows above it) until something else resizes.
 *
 * So a proposal below the floor is treated as "mid-animation, not a real target"
 * and skipped, keeping the last good size. A genuinely tiny window then renders
 * clipped, which is strictly better than a destroyed pane layout.
 */
export const MIN_COLS = 20;
export const MIN_ROWS = 5;

export interface Geometry {
  cols: number;
  rows: number;
}

export function isUsableGeometry(dims: Geometry | undefined | null): boolean {
  if (!dims) return false;
  const { cols, rows } = dims;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return false;
  return cols >= MIN_COLS && rows >= MIN_ROWS;
}
