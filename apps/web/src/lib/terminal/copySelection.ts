/**
 * Copy-on-select for the desktop terminal: the moment a mouse selection is released,
 * its text goes to the clipboard.
 *
 * **Why not Cmd+C like anywhere else.** The selection does not survive long enough.
 * claude's TUI asks for any-motion mouse tracking (DECSET 1003, passed through by tmux
 * with `mouse off`), so xterm reports every pointer move to the app — and it counts each
 * report as user input, which clears the selection (`SelectionService` listens to
 * `onUserInput`). Shift/Option+drag selects, the next nudge of the mouse wipes it, and
 * Cmd+C finds nothing. A right-click is worse: its own mousedown is reported first. Off
 * a Mac there is not even a key for it — Ctrl+C is the app's interrupt and
 * Ctrl+Shift+C opens the browser's inspector. Release is the one moment the selection
 * is guaranteed to exist, so that is when it is copied.
 *
 * Two paths, because the async clipboard only exists in a secure context (https, or
 * localhost): `document.execCommand("copy")` with a one-shot `copy` listener supplying
 * the text works over plain http too, inside the mouseup's user activation.
 */

export interface ClipboardEnv {
  /** `navigator.clipboard` — absent outside a secure context. */
  clipboard?: { writeText(text: string): Promise<void> };
  /** The legacy path; true when the browser reports the copy done. */
  execCopy(text: string): boolean;
}

/** Puts `text` on the clipboard by whichever path works; true when one did. */
export async function copyText(text: string, env: ClipboardEnv): Promise<boolean> {
  if (!text) return false;
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no focus, no permission): the legacy path may still be allowed.
    }
  }
  return env.execCopy(text);
}

/** The browser's own clipboard paths. */
export function browserClipboard(): ClipboardEnv {
  return {
    clipboard: window.isSecureContext ? navigator.clipboard : undefined,
    execCopy(text) {
      const supply = (e: ClipboardEvent) => {
        e.clipboardData?.setData("text/plain", text);
        e.preventDefault();
        e.stopPropagation();
      };
      document.addEventListener("copy", supply, { capture: true });
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        document.removeEventListener("copy", supply, { capture: true });
      }
    },
  };
}
