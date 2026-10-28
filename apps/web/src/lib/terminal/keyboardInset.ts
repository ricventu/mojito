/**
 * Geometry for pinning the terminal view to the *visible* viewport.
 *
 * The terminal's root (`TerminalPage`) is `position: fixed; top: 0; height: 100dvh`,
 * so it sizes to the full layout viewport. When the mobile virtual keyboard opens, only the visual
 * viewport shrinks (the default `interactive-widget=resizes-visual`), so the
 * container keeps extending under the keyboard and its bottom band — the active
 * input line and the accessory bar — is hidden. Sizing the container to
 * `visualViewport.height` (and shifting it by `visualViewport.offsetTop`, which
 * is non-zero when the visible band is scrolled away from the layout top) keeps
 * that band above the keyboard.
 */
export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
}

export interface TermRootStyle {
  height: string;
  transform: string;
}

export function termRootStyle(vv: VisualViewportMetrics): TermRootStyle {
  const height = Math.max(0, Math.round(vv.height));
  const offset = Math.max(0, Math.round(vv.offsetTop));
  return { height: `${height}px`, transform: `translateY(${offset}px)` };
}

/**
 * Is the virtual keyboard up?
 *
 * The visible band then holds only ~13 terminal rows, and Mojito's own single
 * header row eats roughly 2 of them — enough that claude's TUI, once it has
 * drawn a recap and a todo panel, has no room left for its input line and
 * simply omits it. The terminal view hides that chrome while this is true.
 *
 * A keyboard takes a large bite; Safari's collapsing toolbars take a small one,
 * hence the threshold rather than any shrink at all.
 */
export const KEYBOARD_MIN_INSET = 140;

export interface ViewportHeights {
  layoutHeight: number;
  visualHeight: number;
}

export function isKeyboardOpen({ layoutHeight, visualHeight }: ViewportHeights): boolean {
  if (!Number.isFinite(layoutHeight) || !Number.isFinite(visualHeight)) return false;
  return layoutHeight - visualHeight >= KEYBOARD_MIN_INSET;
}

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
