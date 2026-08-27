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

/**
 * One pass of "keep the pty and the terminal the same size".
 *
 * Two separate things happen here, and keeping them separate is the whole point.
 * *Re-fitting* — re-measuring the terminal against the box it sits in — is
 * refused in two cases: while the mobile keyboard is up (the terminal keeps the
 * rows it had and `.term-body` shows the bottom of them, so the TUI's input line
 * stays on screen without claude's whole layout being resized against a band we
 * cannot measure), and for a geometry the keyboard is only passing through (see
 * `isUsableGeometry` above).
 *
 * *Publishing* the geometry is not refused, ever. `send` is the client's only
 * channel for telling the pty how big the terminal is, and the pty starts life
 * at the gateway's 80x24 spawn default. Skipping it alongside the fit meant a
 * socket that (re)connected while the keyboard was up — a phone coming back from
 * the background with the keyboard restored, a deploy, any 1.5s reconnect —
 * spawned its `tmux attach` at 24 rows and had nothing left to correct it. tmux
 * then repainted claude's whole TUI into the top 24 rows of a grid the terminal
 * still held ~54 of, and the bottom-anchored view showed nothing but the blank
 * rows underneath: the input line off the top of the screen, which is exactly how
 * RIC-258 was reported. Re-sending a geometry the pty already has is a no-op.
 */
export interface GeometrySync {
  /** Is the mobile virtual keyboard up? (see keyboardInset.ts) */
  keyboardOpen: boolean;
  /** FitAddon's proposal for the box the terminal sits in. */
  propose: () => Geometry | undefined;
  /** Re-measure the terminal against that box. */
  refit: () => void;
  /** Tell the pty the geometry the terminal actually has. */
  send: () => void;
}

export function syncGeometry(s: GeometrySync): void {
  if (!s.keyboardOpen && isUsableGeometry(s.propose())) s.refit();
  s.send();
}
