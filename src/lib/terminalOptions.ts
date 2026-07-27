import type { ITerminalOptions } from "@xterm/xterm";

/**
 * Constructor options for the browser terminal.
 *
 * Kept out of the component so the one setting that silently corrupts the
 * screen can be pinned by a test: **convertEol must stay off.**
 *
 * The pty gateway attaches with `TERM=xterm-color`, whose terminfo defines
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
    fontSize: 13,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    theme: { background: "#08090a", foreground: "#c9d1d9", cursor: "#5ce08a" },
  };
}
