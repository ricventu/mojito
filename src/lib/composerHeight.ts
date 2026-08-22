/**
 * Height for the terminal composer's textarea, in px.
 *
 * The composer is a real `<textarea>` because iOS's text-editing features —
 * dictation, and the space-hold gesture that turns the keyboard into a caret
 * trackpad — only work against a genuine editable field holding real content.
 * xterm's hidden helper textarea is neither: it is one cell wide at
 * `zIndex: -5`, it is cleared on Enter, Ctrl-C and blur, and nothing in xterm
 * converts a native caret move into a cursor key. See AccessoryBar.
 *
 * Which means the field has to be readable: a dictated prompt runs to several
 * lines, and a one-line slot you cannot read back into defeats the point of
 * composing outside the terminal at all. So it grows with its content — but
 * only to `maxLines`, because it grows *into* `.term-body`. With the keyboard
 * up the whole visible band is ~13 rows (`keyboardInset.ts`), and an uncapped
 * field would push claude's input line off the top of it.
 *
 * The DOM read stays with the caller so this half is testable under the
 * node-only vitest setup — the same split as `termRootStyle` ÷ the viewport
 * effect, or `resolveInitialToken` ÷ `useToken`.
 */
export interface ComposerMetrics {
  /** The textarea's measured `scrollHeight`: content plus padding, no border. */
  scrollHeight: number;
  /** Resolved px per line of text. */
  lineHeight: number;
  /** Padding top + bottom, in px. */
  verticalPadding: number;
  /** Border top + bottom, in px. */
  verticalBorder: number;
  /** Lines to grow to before the field starts scrolling instead. */
  maxLines: number;
}

/**
 * Returns the height to pin the textarea at, or `null` when the box cannot be
 * measured yet — `getComputedStyle().lineHeight` reads "normal" until the font
 * metrics resolve, and answering from the NaN that parses out of it would pin
 * the field to a number derived from nothing. `null` leaves the CSS
 * `min-height` in charge for that pass.
 *
 * The answer is a **border-box** height, since everything here is
 * `box-sizing: border-box` (globals.css): the border has to be added back on
 * top of a `scrollHeight` that never counted it.
 */
export function composerHeight(
  { scrollHeight, lineHeight, verticalPadding, verticalBorder, maxLines }: ComposerMetrics,
): number | null {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
  const chrome = verticalPadding + verticalBorder;
  const min = lineHeight + chrome;
  const max = lineHeight * maxLines + chrome;
  // Round up: a measurement landing on a fraction otherwise leaves the field a
  // hair short of its own content, and iOS answers that with a scrollbar.
  const measured = Number.isFinite(scrollHeight)
    ? Math.ceil(scrollHeight) + verticalBorder
    : min;
  return Math.min(Math.max(measured, min), max);
}
