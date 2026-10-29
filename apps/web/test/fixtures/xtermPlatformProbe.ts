// Bundled by platform.build.test.ts with the app's own Vite config, then run as a browser would.
import { Terminal } from "@xterm/xterm";

/** The platform record xterm's keyboard path reads (`_core.browser`), off a throwaway terminal. */
export function xtermPlatform(): { isNode?: unknown; isMac?: unknown } {
  const term = new Terminal();
  try {
    const browser = (term as unknown as { _core?: { browser?: { isNode?: unknown; isMac?: unknown } } })._core?.browser;
    return { isNode: browser?.isNode, isMac: browser?.isMac };
  } finally {
    term.dispose();
  }
}
