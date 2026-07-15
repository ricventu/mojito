/**
 * Geometry for pinning the terminal view to the *visible* viewport.
 *
 * `.term-root` is `position: fixed; top: 0; height: 100dvh`, so it sizes to the
 * full layout viewport. When the mobile virtual keyboard opens, only the visual
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
