type KeyEvent = Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "preventDefault">;

/**
 * xterm's custom key handler for the session terminal (`false` = xterm must not handle it).
 * Enter submits in claude's TUI; Shift+Enter must insert a newline. xterm sends a bare CR
 * either way, so Shift+Enter is sent as LF (`chat:newline`).
 *
 * The keydown must be cancelled too: returning `false` only stops xterm's keydown path, the
 * browser still fires a keypress for Enter, and xterm sends that as a CR — LF then CR,
 * newline then submit. A cancelled keydown fires no keypress.
 */
export function terminalKeyHandler(send: (data: string) => void): (e: KeyEvent) => boolean {
  return (e) => {
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      send("\n");
      return false;
    }
    return true;
  };
}
