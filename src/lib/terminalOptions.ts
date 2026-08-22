import type { ITerminalOptions } from "@xterm/xterm";

/**
 * Constructor options for the browser terminal.
 *
 * Kept out of the component so the two settings that would otherwise be
 * invisible can be pinned by a test: **convertEol must stay off**, and
 * **macOptionClickForcesSelection must stay on**.
 *
 * ## macOptionClickForcesSelection — the only way to select text on a Mac
 *
 * claude's TUI turns on mouse tracking (the same fact `touchScroll` relies on
 * to know its wheel events will land), and xterm answers that by handing the
 * app every mouse event and calling `_selectionService.disable()`. Its one
 * escape hatch is `SelectionService.shouldForceSelection`, which reads
 * `event.shiftKey` off a Mac but `event.altKey && macOptionClickForcesSelection`
 * on one — and that option defaults to `false`. So macOS had *no gesture at
 * all* that selected terminal text, while shift+drag already worked on Linux
 * and Windows. Native browser selection is no fallback either: xterm.css sets
 * `.xterm { user-select: none }` and its always-on `mousedown` listener
 * `preventDefault()`s unconditionally.
 *
 * Turning it on also flips Option+drag from a **column** selection to a normal
 * one — `shouldColumnSelect` is `altKey && !(isMac && thisOption)` — which is
 * the half of the trade worth stating: a Mac loses block-select (only ever
 * reachable in a session with mouse tracking *off*, since selection is
 * disabled otherwise) and gains flowing selection everywhere. A rectangle cut
 * out of a TUI is not what anyone is copying.
 *
 * The renderer has nothing to do with any of this: WebGL draws the selection
 * layer itself, and the DOM renderer was equally unselectable before RIC-239.
 * A phone is a separate problem again — a touch drag produces no mouse events
 * for xterm to read — which is what `terminalText.ts` is for.
 *
 * The pty gateway attaches with `TERM=xterm-256color`, whose terminfo defines
 * `cud1=\n`. tmux therefore moves the cursor down one row by emitting a bare
 * LF, relying on the column being preserved. `convertEol: true` makes xterm
 * treat every LF as CRLF, so the column snaps to 0 and tmux's following cell
 * run is written left of where it belongs (observed: rows losing their leading
 * two-space indent). tmux redraws differentially against its own model of the
 * screen, so it never repaints those cells — the damage is permanent and
 * survives scrolling.
 *
 * Nothing needs convertEol: the only bare-LF text in the stream is the
 * `capture-pane` scrollback replay, which the server already converts to CRLF
 * (`ptyGateway.ts`).
 */
export function terminalOptions(): ITerminalOptions {
  return {
    macOptionClickForcesSelection: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    theme: { background: "#08090a", foreground: "#c9d1d9", cursor: "#5ce08a" },
  };
}
