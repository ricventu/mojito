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
 * The rows are what a *program* wrapped, not what the terminal wrapped, and
 * that program uses its own margins. Measured on a live 49-column phone pane
 * showing claude's MCP auth prompt:
 *
 *      col 0   1234567890...                                    48
 *              ‹2›https://claude.ai/api/organizations/02960d4e-‹2›
 *              ‹2›e57a-4499-8561-5c5199aa6328/mcp/start-auth/mc‹2›
 *              ‹2›psrv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface‹2›
 *              ‹2›=cli
 *
 * — a 2-cell indent and a 2-cell right margin, so each piece is 45 wide and no
 * row reaches the last column. Both facts matter: rows are joined on their
 * *bodies* (the indent is the block's margin, not part of the URL), and
 * "continues below" cannot mean "fills the row".
 *
 * What it means instead is "ends at the block's wrap width". That width is
 * measured from the rows themselves — the longest body in the run of adjacent
 * rows sharing an indent — so no assumption about the wrapping program's
 * margins is baked in. A width is only believed to be a wrap width when the
 * rows corroborate it: either several of them end at exactly that column (the
 * signature of a hard-wrapped block), or the one that does also sits within a
 * few cells of the right edge.
 *
 * A block's margin is not always spaces. claude opens a bullet with `● ` in the
 * margin and continues it with two spaces, so the row carrying the URL has no
 * leading whitespace at all:
 *
 *      col 0   1234567890...                                    48
 *              ● MR aperta: https://gitlab.com/factorybook/Gesti
 *                onaleCooperativeMvp/-/merge_requests/6
 *
 * Read by leading whitespace those two rows sit in different blocks, and the
 * link stopped at `Gesti` — a wrong URL again. So a row whose margin is filled
 * by one unbroken token and a space (`● `, `- `, `1. `) is read at the indent of
 * the row below it: a marker row opens the block it hangs over.
 *
 * Two consequences worth knowing. A URL that genuinely ends at the wrap width
 * with unrelated non-blank text directly below gets that text glued on; nothing
 * in the buffer distinguishes it from a wrap. And a narrow wrapped block inside
 * a wide terminal is only joined when at least two of its rows end at the same
 * column, since a lone short row that far from the edge is no evidence at all.
 */

// Copied from @xterm/addon-web-links (MIT) so what counts as a URL stays
// identical to the addon this replaces: everything from http(s):// up to the
// first whitespace or quote, minus trailing interpunction and brackets.
const URL_REGEX =
  /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/;

/** Bounds on how much of the screen one logical line may draw from. */
export const MAX_RUN_ROWS = 40;
export const MAX_JOINED_CHARS = 2048;

/**
 * How far short of the right edge a single row may end and still count as
 * wrapped. Covers the right margin a TUI leaves itself (2 cells in the pane
 * measured above); beyond that a lone row is not evidence of wrapping.
 */
export const EDGE_SLACK = 4;

export type TerminalLinkMatch = {
  text: string;
  /** 0-based buffer row, plus a 0-based index into that row's string. */
  start: { row: number; char: number };
  /** Inclusive: the position of the URL's last character. */
  end: { row: number; char: number };
};

/** Reads a buffer row space-padded to the terminal width, or undefined past the end. */
export type RowReader = (index: number) => string | undefined;

/** A row split into the block margin it carries and the text after it. */
type Row = { index: number; indent: number; body: string };

/**
 * Find the URLs crossing `row`, joining the rows around it that the program
 * writing to the terminal broke mid-URL.
 */
export function findTerminalLinks(
  row: number,
  getRow: RowReader,
  cols: number,
): TerminalLinkMatch[] {
  const pieces = wrappedPieces(row, getRow, cols);
  if (!pieces.length) return [];

  const joined = pieces.map((piece) => piece.body).join("");
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

function readRow(getRow: RowReader, index: number): Row | undefined {
  const raw = getRow(index);
  if (raw === undefined) return undefined;
  const trimmed = raw.trimEnd();
  const indent = trimmed.length - trimmed.trimStart().length;
  return { index, indent, body: trimmed.slice(indent) };
}

/** One unbroken token and the space after it: what fills a hanging indent. */
const MARKER = /^\s*\S+\s+$/;

/**
 * Re-read a row as the opening row of a block indented to `indent` — the row
 * whose margin is filled by a marker (`● `, `- `, `1. `) instead of by spaces,
 * so its leading whitespace understates where its text starts.
 */
function hangingRow(getRow: RowReader, index: number, indent: number): Row | undefined {
  const raw = getRow(index);
  if (raw === undefined) return undefined;
  const trimmed = raw.trimEnd();
  if (trimmed.length <= indent || trimmed[indent] === " ") return undefined;
  if (!MARKER.test(trimmed.slice(0, indent))) return undefined;
  return { index, indent, body: trimmed.slice(indent) };
}

/** The adjacent rows sharing `row`'s indent: the block it belongs to. */
function sameIndentRun(row: number, getRow: RowReader): Row[] | undefined {
  const plain = readRow(getRow, row);
  if (!plain) return undefined;

  // The row below shows where this block's text starts; if `row` is a marker
  // row, that is further right than its own (empty) leading whitespace.
  const next = readRow(getRow, row + 1);
  const current =
    (next && next.indent > plain.indent && hangingRow(getRow, row, next.indent)) || plain;

  const run = [current];
  let chars = current.body.length;
  const room = () => run.length < MAX_RUN_ROWS && chars < MAX_JOINED_CHARS;

  for (let i = row - 1; i >= 0 && room(); i--) {
    const above = readRow(getRow, i);
    if (!above) break;
    if (above.indent !== current.indent) {
      // A marker row is the block's first row: take it, then stop.
      const opener = hangingRow(getRow, i, current.indent);
      if (opener) run.unshift(opener);
      break;
    }
    run.unshift(above);
    chars += above.body.length;
  }
  for (let i = row + 1; room(); i++) {
    const below = readRow(getRow, i);
    if (!below || below.indent !== current.indent) break;
    run.push(below);
    chars += below.body.length;
  }
  return run;
}

/**
 * The rows to read as one logical line: `row`, plus the neighbours that end at
 * the block's wrap width and therefore continue into it.
 */
function wrappedPieces(row: number, getRow: RowReader, cols: number): Row[] {
  const run = sameIndentRun(row, getRow);
  if (!run) return [];
  const current = run.find((r) => r.index === row)!;

  const width = Math.max(...run.map((r) => r.body.length));
  const endingAtWidth = run.filter((r) => r.body.length === width).length;
  const nearEdge = width >= cols - current.indent - EDGE_SLACK;
  if (width === 0 || (endingAtWidth < 2 && !nearEdge)) return [current];

  // Walk out while rows keep ending at the wrap width. The first row that stops
  // short is still taken going down — it holds the tail of the wrapped text.
  const index = run.indexOf(current);
  let start = index;
  let end = index;
  while (start > 0 && run[start - 1].body.length >= width) start--;
  while (end < run.length - 1 && run[end].body.length >= width) end++;
  return run.slice(start, end + 1);
}

/**
 * Map an index into the joined text back to the row and column it came from,
 * putting the block's indent back on.
 */
function locate(pieces: Row[], index: number): { row: number; char: number } | null {
  let offset = 0;
  for (const piece of pieces) {
    if (index < offset + piece.body.length) {
      return { row: piece.index, char: piece.indent + index - offset };
    }
    offset += piece.body.length;
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
