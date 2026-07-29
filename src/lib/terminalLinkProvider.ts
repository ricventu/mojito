import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { findTerminalLinks } from "./terminalLinks";

/**
 * xterm link provider for http(s) URLs, backed by `terminalLinks.ts` — which
 * exists because `WebLinksAddon` cannot join a URL split across rows in a tmux
 * stream. See that file for the why.
 *
 * `bufferLineNumber` and the returned range are in the addon's coordinate
 * space: 1-based rows of `buffer.active` (so scrollback included), and a range
 * whose `end.x` is the link's last cell.
 */
export function urlLinkProvider(
  term: Terminal,
  activate: (event: MouseEvent, uri: string) => void,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const buffer = term.buffer.active;
      const getRow = (index: number) => buffer.getLine(index)?.translateToString(false);
      const links: ILink[] = [];
      for (const match of findTerminalLinks(bufferLineNumber - 1, getRow, term.cols)) {
        const startLine = buffer.getLine(match.start.row);
        const endLine = buffer.getLine(match.end.row);
        if (!startLine || !endLine) continue;
        links.push({
          text: match.text,
          range: {
            start: { x: cellOfChar(startLine, match.start.char) + 1, y: match.start.row + 1 },
            end: { x: cellOfChar(endLine, match.end.char) + 1, y: match.end.row + 1 },
          },
          activate,
        });
      }
      callback(links);
    },
  };
}

/**
 * Column holding the char at `charIndex` of the row's string form. Not the same
 * number: `translateToString` emits one entry per cell of non-zero width, so a
 * wide char (its second cell has width 0) or a cell carrying a combining mark
 * shifts every column after it.
 */
function cellOfChar(line: IBufferLine, charIndex: number): number {
  let chars = 0;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell || cell.getWidth() === 0) continue;
    chars += cell.getChars().length || 1;
    if (charIndex < chars) return x;
  }
  return Math.max(line.length - 1, 0);
}
