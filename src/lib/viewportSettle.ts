/**
 * When to take another look at the visible band.
 *
 * The mobile keyboard does not arrive in one step: iOS fires a run of
 * `visualViewport` resize events while it animates, and the band is still moving
 * when the last one lands. Whatever height was read then becomes the terminal's
 * box — measured live, that left the pty at 32 rows while roughly 29 were
 * visible, so claude's TUI drew its input box below the fold and only the box's
 * top border (with the cursor squashed onto it) was on screen.
 *
 * Re-fitting the same box does not help; the band itself has to be re-read,
 * because no further event is guaranteed to arrive and correct a mid-animation
 * value. So each pass re-reads it and re-arms while the number keeps changing,
 * with a cap so a viewport that never settles cannot re-arm forever.
 */
export const SETTLE_MAX_PASSES = 6;

export interface SettleState {
  band: number;
  lastBand: number;
  passes: number;
}

export function keepSettling({ band, lastBand, passes }: SettleState): boolean {
  if (passes >= SETTLE_MAX_PASSES) return false;
  return band !== lastBand;
}
