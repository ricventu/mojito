/**
 * Clickable http(s) URLs in the terminal — including the ones a program wrapped over
 * several rows.
 *
 * xterm's `WebLinksAddon` joins rows only when they carry xterm's soft-wrap flag
 * (`isWrapped`), set when xterm itself wraps a write past the last column. Nothing in
 * Mojito's stream ever does: the gateway replays `capture-pane` as CRLF-terminated rows and
 * tmux places the cursor explicitly on every redraw. A long URL then linkified only its
 * first row — to a truncated, wrong target — and the rest was dead text.
 *
 * The rows are what a *program* wrapped, inside its own margins. Measured on a 49-column
 * phone pane showing claude's MCP auth prompt: a 2-cell indent and a 2-cell right margin,
 * so no row reaches the last column —
 *
 *     ‹2›https://claude.ai/api/organizations/02960d4e-‹2›
 *     ‹2›e57a-4499-8561-5c5199aa6328/mcp/start-auth/mc‹2›
 *     ‹2›psrv_01VTuVZBNxRRAJzX5tNk6Kmb?product_surface‹2›
 *     ‹2›=cli
 *
 * So rows are joined on their *bodies* (the indent is the block's margin, not URL), and
 * "continues below" means "ends at the block's wrap width": the longest body among the
 * adjacent rows sharing an indent. That width is believed only when the rows corroborate
 * it — two of them end exactly there (a hard-wrapped block), or it sits within
 * `EDGE_SLACK` cells of the right edge. A word-wrapped paragraph has ragged ends, so a URL
 * that merely ends a line short of the width keeps its neighbour off.
 *
 * A margin is not always spaces: claude opens a bullet with `● ` and continues it with two
 * spaces, so the row holding the URL has no leading whitespace —
 *
 *     ● MR aperta: https://gitlab.com/factorybook/Gesti
 *       onaleCooperativeMvp/-/merge_requests/6
 *
 * — hence a marker row (one token and a space filling the margin: `● `, `- `, `1. `) is
 * read at the indent of the row below it: it opens the block it hangs over.
 *
 * Known limit: a URL that genuinely ends at the wrap width with unrelated text right below
 * gets that text glued on — nothing in the buffer tells it from a wrap.
 *
 * The same joined line also yields markdown paths (`docs/superpowers/specs/x.md`, `~/x.md`,
 * an absolute one, a mention's `@docs/x.md` without its `@`) when the terminal has somewhere to
 * open them — the docs viewer, which asks the server what the path means. A path with a `..`
 * segment is no link (the server would refuse it), nor is one inside a URL, and paths with
 * spaces are a known limit.
 */
import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

// `@xterm/addon-web-links`' matcher (MIT): http(s):// up to the first whitespace or quote,
// minus trailing punctuation and brackets.
const URL_REGEX = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':,.!?{}|\\\^~\[\]`()<>]/;

// A markdown path: an optional ~/, / or ./ (or the @ of a mention) then segments ending in .md,
// not glued to a path character on the left nor to a word or a further segment on the right.
// Letters are Unicode's (`spec-perché.md`), combining marks included.
const DOC_REGEX =
  /(?<![\p{L}\p{M}\p{N}_./~@+-])(?:~\/|\/|\.\/|@)?(?:[\p{L}\p{M}\p{N}_.@+-]+\/)*[\p{L}\p{M}\p{N}_.@+-]+\.md(?![\p{L}\p{M}\p{N}_/])/giu;
/** What a path's link leaves out in front: a `./` (the same document) or a mention's `@`. */
const DOC_LEAD = /^(?:\.\/|@)/;

/** Bounds on how much of the screen one logical line may draw from. */
export const MAX_ROWS = 40;
export const MAX_CHARS = 2048;
/** How far short of the right edge a lone row may end and still count as wrapped. */
export const EDGE_SLACK = 4;

/** A position as a 0-based buffer row and a 0-based index into that row's string. */
export interface RowChar {
  row: number;
  char: number;
}

export interface FoundLink {
  /** An http(s) URL, or a markdown path for the docs viewer. */
  kind: "url" | "doc";
  text: string;
  start: RowChar;
  /** Inclusive: the URL's last character. */
  end: RowChar;
}

/** A buffer row space-padded to the terminal width, or undefined past the end. */
export type RowReader = (row: number) => string | undefined;

/** A row split into its block margin and the text after it. */
interface Piece {
  row: number;
  indent: number;
  body: string;
  /** The margin is a marker (`● `), not spaces: the first row of its block. */
  hanging: boolean;
}

const MARKER = /^\s*\S+\s+$/;

/**
 * Read `row`; with `indent`, a row whose own leading whitespace is shorter is re-read at
 * that indent when a marker fills the margin (a hanging first row).
 */
function readPiece(getRow: RowReader, row: number, indent?: number): Piece | undefined {
  const raw = getRow(row);
  if (raw === undefined) return undefined;
  const text = raw.trimEnd();
  const own = text.length - text.trimStart().length;
  if (indent !== undefined && indent > own && text.length > indent && text[indent] !== " " && MARKER.test(text.slice(0, indent))) {
    return { row, indent, body: text.slice(indent), hanging: true };
  }
  return { row, indent: own, body: text.slice(own), hanging: false };
}

/** The adjacent rows sharing `row`'s indent: the block it belongs to. */
function blockAround(row: number, getRow: RowReader): Piece[] {
  const plain = readPiece(getRow, row);
  if (!plain) return [];
  // The row below shows where this block's text starts — further right than a marker
  // row's own (empty) leading whitespace.
  const next = readPiece(getRow, row + 1);
  const current = (next && next.indent > plain.indent && readPiece(getRow, row, next.indent)) || plain;

  const block = [current];
  let chars = current.body.length;
  const room = () => block.length < MAX_ROWS && chars < MAX_CHARS;
  if (!current.hanging) {
    for (let r = row - 1; r >= 0 && room(); r--) {
      const above = readPiece(getRow, r, current.indent);
      if (!above || above.indent !== current.indent) break;
      block.unshift(above);
      chars += above.body.length;
      if (above.hanging) break;
    }
  }
  // Plain reads only: a marker row below opens the next block.
  for (let r = row + 1; room(); r++) {
    const below = readPiece(getRow, r);
    if (!below || below.indent !== current.indent) break;
    block.push(below);
    chars += below.body.length;
  }
  return block;
}

/** `row` plus the neighbours that end at the block's wrap width and so continue into it. */
function logicalLine(row: number, getRow: RowReader, cols: number): Piece[] {
  const block = blockAround(row, getRow);
  const at = block.findIndex((p) => p.row === row);
  if (at < 0) return [];
  const width = Math.max(...block.map((p) => p.body.length));
  const atWidth = block.filter((p) => p.body.length === width).length;
  const nearEdge = width >= cols - block[at].indent - EDGE_SLACK;
  if (width === 0 || (atWidth < 2 && !nearEdge)) return [block[at]];

  // Going down, the first row that stops short is still taken: it holds the tail.
  let start = at;
  let end = at;
  while (start > 0 && block[start - 1].body.length === width) start--;
  while (end < block.length - 1 && block[end].body.length === width) end++;
  return block.slice(start, end + 1);
}

/** An index into the joined bodies, mapped back to its row and character. */
function locate(pieces: Piece[], index: number): RowChar | null {
  let offset = 0;
  for (const p of pieces) {
    if (index < offset + p.body.length) return { row: p.row, char: p.indent + index - offset };
    offset += p.body.length;
  }
  return null;
}

/** The addon's own guard: the URL parser must read the match back as the same URL. */
function isUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    const credentials = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}@` : "";
    return candidate.toLowerCase().startsWith(`${url.protocol}//${credentials}${url.host}`.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The URLs crossing `row` — and with `docs`, the markdown paths — joined across the rows a
 * program wrapped them over.
 */
export function findLinks(row: number, getRow: RowReader, cols: number, opts: { docs?: boolean } = {}): FoundLink[] {
  const pieces = logicalLine(row, getRow, cols);
  const joined = pieces.map((p) => p.body).join("");
  const links: FoundLink[] = [];
  const urls: [number, number][] = [];
  const add = (kind: FoundLink["kind"], text: string, from: number, length: number) => {
    const start = locate(pieces, from);
    const end = locate(pieces, from + length - 1);
    if (start && end && start.row <= row && end.row >= row) links.push({ kind, text, start, end });
  };
  for (const m of joined.matchAll(new RegExp(URL_REGEX.source, "g"))) {
    if (!isUrl(m[0])) continue;
    urls.push([m.index, m.index + m[0].length]);
    add("url", m[0], m.index, m[0].length);
  }
  if (!opts.docs) return links;
  for (const m of joined.matchAll(DOC_REGEX)) {
    const from = m.index;
    const to = from + m[0].length;
    if (m[0].split("/").includes("..") || urls.some(([a, b]) => from < b && to > a)) continue;
    const lead = DOC_LEAD.exec(m[0])?.[0].length ?? 0;
    add("doc", m[0].slice(lead), from + lead, m[0].length - lead);
  }
  return links;
}

/** Just the half of xterm's `IBufferLine` the cell mapping reads. */
export type CellLine = Pick<IBufferLine, "length" | "getCell">;

/**
 * The 0-based cell holding character `char` of the row's `translateToString` form. Not the
 * same number: a wide character's second cell (width 0) emits nothing, and a cell with a
 * combining mark emits more than one character.
 */
export function cellOfChar(line: CellLine, char: number): number {
  let seen = 0;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    seen += cell.getChars().length || 1;
    if (char < seen) return x;
  }
  return Math.max(line.length - 1, 0);
}

/** What a tapped link does: a URL opens out of the app; a doc path only when `openDoc` is given. */
export interface LinkHandlers {
  openUrl(url: string): void;
  openDoc?(path: string): void;
}

/**
 * The xterm link provider over `findLinks`. Ranges are xterm's: 1-based rows of the active
 * buffer (scrollback included), `end.x` the link's last cell. `handlers` is read at each call,
 * so it may change without the provider being registered again.
 */
export function terminalLinkProvider(term: Terminal, handlers: () => LinkHandlers): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const buffer = term.buffer.active;
      const getRow = (row: number) => buffer.getLine(row)?.translateToString(false);
      const links: ILink[] = [];
      for (const found of findLinks(y - 1, getRow, term.cols, { docs: !!handlers().openDoc })) {
        const first = buffer.getLine(found.start.row);
        const last = buffer.getLine(found.end.row);
        if (!first || !last) continue;
        links.push({
          text: found.text,
          range: {
            start: { x: cellOfChar(first, found.start.char) + 1, y: found.start.row + 1 },
            end: { x: cellOfChar(last, found.end.char) + 1, y: found.end.row + 1 },
          },
          activate: () => {
            const { openUrl, openDoc } = handlers();
            if (found.kind === "url") openUrl(found.text);
            else openDoc?.(found.text);
          },
        });
      }
      callback(links);
    },
  };
}
