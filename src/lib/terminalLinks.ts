/**
 * URL detection for the browser terminal, across rows.
 *
 * Replaces `WebLinksAddon`, which cannot work against a tmux stream. The
 * addon's `LinkComputer` joins the rows of a URL wider than the terminal only
 * when the continuation rows carry xterm's soft-wrap flag (`IBufferLine
 * .isWrapped`) — set when xterm itself wraps a write past the last column.
 * Nothing in Mojito's stream ever does that: the pty gateway replays tmux
 * `capture-pane` output as discrete CRLF-terminated rows (`ptyGateway.ts`), and
 * live tmux redraws place the cursor explicitly. Every row therefore lands
 * unwrapped, and a long URL was matched only inside its first row: that
 * fragment became the link target (a wrong URL — the observed bug), while its
 * continuation rows held no `https://` and were not clickable at all.
 *
 * So continuation is decided by geometry instead: a row whose last cell is not
 * blank has run into the right edge, so the row below continues it. Rows are
 * joined with no separator, exactly as a soft wrap would be.
 *
 * The heuristic cannot distinguish "wrapped here" from "happened to end at the
 * last column", so a URL that ends exactly at the edge with unrelated non-blank
 * text directly below it gets that text glued on. On a ~46-column phone a
 * wrapped URL is the overwhelmingly common case, and TUI output below a filled
 * row is almost always blank or indented, so the trade is worth it.
 */

// Copied from @xterm/addon-web-links (MIT) so what counts as a URL stays
// identical to the addon this replaces: everything from http(s):// up to the
// first whitespace or quote, minus trailing interpunction and brackets.
const URL_REGEX =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/;

/** Upper bound on the joined text, matching the addon's own cap. */
export const MAX_JOINED_CHARS = 2048;

export type TerminalLinkMatch = {
  text: string;
  /** 0-based buffer row, plus a 0-based index into that row's string. */
  start: { row: number; char: number };
  /** Inclusive: the position of the URL's last character. */
  end: { row: number; char: number };
};

type Piece = { row: number; text: string };

/** A row ran into the right edge, so whatever follows continues it. */
const reachesEdge = (text: string | undefined): boolean =>
  text !== undefined && text.length > 0 && !text.endsWith(" ");

/**
 * Find the URLs crossing `row`, joining the rows around it that the terminal
 * broke mid-URL. `getRow` returns a row space-padded to the terminal width
 * (xterm's `translateToString(false)`), or undefined past the buffer.
 */
export function findTerminalLinks(
  row: number,
  getRow: (index: number) => string | undefined,
): TerminalLinkMatch[] {
  const pieces = rowWindow(row, getRow);
  if (!pieces.length) return [];

  const joined = pieces.map((p) => p.text).join("");
  const rex = new RegExp(URL_REGEX.source, `${URL_REGEX.flags}g`);
  const links: TerminalLinkMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = rex.exec(joined))) {
    const text = match[0];
    if (!isUrl(text)) continue;
    const start = locate(pieces, match.index);
    const end = locate(pieces, match.index + text.length - 1);
    if (start && end) links.push({ text, start, end });
  }
  return links;
}

/**
 * The rows to consider as one logical line: `row` plus the run of edge-filled
 * rows above and below it. A row containing a blank cell ends the run — a URL
 * cannot span one — but is still included, since the URL may start or end in it.
 */
function rowWindow(row: number, getRow: (index: number) => string | undefined): Piece[] {
  const current = getRow(row);
  if (current === undefined) return [];

  const pieces: Piece[] = [];

  // Upward: only if this row can be a continuation at all. One starting with a
  // blank cell never is.
  if (!current.startsWith(" ")) {
    let budget = MAX_JOINED_CHARS - current.length;
    for (let i = row - 1; i >= 0; i--) {
      const text = getRow(i);
      if (!reachesEdge(text)) break;
      budget -= text!.length;
      if (budget < 0) break;
      pieces.unshift({ row: i, text: text! });
      if (text!.includes(" ")) break;
    }
  }

  pieces.push({ row, text: current.trimEnd() });

  // Downward: keep taking rows while the one before ran into the edge.
  let budget = MAX_JOINED_CHARS - current.length;
  let previous = current;
  for (let i = row + 1; reachesEdge(previous); i++) {
    const text = getRow(i);
    if (text === undefined) break;
    const trimmed = text.trimEnd();
    budget -= trimmed.length;
    if (budget < 0) break;
    pieces.push({ row: i, text: trimmed });
    if (trimmed.includes(" ")) break;
    previous = text;
  }

  return pieces;
}

/** Map an index into the joined text back to the row and column it came from. */
function locate(pieces: Piece[], index: number): { row: number; char: number } | null {
  let offset = 0;
  for (const piece of pieces) {
    if (index < offset + piece.text.length) return { row: piece.row, char: index - offset };
    offset += piece.text.length;
  }
  return null;
}

/**
 * Reject a match the URL parser does not read back as the same URL — the
 * addon's own guard against things like `https://:` slipping through.
 */
function isUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    const credentials = url.username
      ? `${url.username}${url.password ? `:${url.password}` : ""}@`
      : "";
    const base = `${url.protocol}//${credentials}${url.host}`;
    return candidate.toLowerCase().startsWith(base.toLowerCase());
  } catch {
    return false;
  }
}
