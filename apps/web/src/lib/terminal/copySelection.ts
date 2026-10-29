/**
 * Getting a desktop mouse selection out of the terminal and onto the clipboard. There
 * are two selections, because claude's TUI asks for any-motion mouse tracking
 * (DECSET 1003): a plain drag goes to claude, a Shift/Option+drag to xterm.
 *
 * **A plain drag is claude's own selection.** claude highlights it and copies it on
 * release (its `copyOnSelect`, on by default) by writing an OSC 52 to its terminal —
 * under tmux both bare and wrapped in tmux's DCS passthrough. tmux drops both unless the
 * window has `allow-passthrough on` (set by the pty gateway at every attach), and xterm.js
 * ignores OSC 52 without a handler: `osc52Text` is the decoding half of that handler.
 * Write-only — a `?` query, an app asking to *read* the clipboard, is never answered.
 *
 * **A Shift/Option+drag is xterm's selection**, and Cmd+C cannot reach it. xterm reports
 * every pointer move to the app and counts each report as user input, which clears the
 * selection (`SelectionService` listens to `onUserInput`): the next nudge of the mouse
 * wipes it. A right-click is worse — its own mousedown is reported first — and off a Mac
 * there is no key at all (Ctrl+C is the app's interrupt, Ctrl+Shift+C the browser's
 * inspector). Release is the one moment it is guaranteed to exist, so it is copied then.
 *
 * Two clipboard paths, because the async clipboard only exists in a secure context
 * (https, or localhost): `document.execCommand("copy")` with a one-shot `copy` listener
 * supplying the text works over plain http too, within the user activation.
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

/**
 * The text an OSC 52 asks to put on the clipboard, from the part after `52;`
 * (`<selection>;<base64>`); null for a read query or anything malformed.
 */
export function osc52Text(data: string): string | null {
  const sep = data.indexOf(";");
  if (sep < 0) return null;
  const payload = data.slice(sep + 1);
  if (!payload || payload === "?") return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Drops a copy that repeats the previous one within `windowMs`. Under tmux, claude sends
 * every OSC 52 twice — bare and DCS-wrapped (`raw+dcs`) — and tmux forwards both, so
 * one selection would otherwise be copied, and announced, twice.
 */
export function echoFilter(windowMs: number): (text: string, now: number) => boolean {
  let last: { text: string; at: number } | null = null;
  return (text, now) => {
    const echo = last !== null && last.text === text && now - last.at < windowMs;
    last = { text, at: now };
    return !echo;
  };
}
