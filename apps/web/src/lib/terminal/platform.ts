import { Terminal } from "@xterm/xterm";

/**
 * Which platform the browser terminal is on — and whether xterm agrees.
 *
 * xterm decides `isMac`/`isWindows`/`isFirefox` **once, at module load**, behind a
 * guard meant to keep the module importable from node:
 *
 * ```ts
 * export const isNode = (typeof process !== 'undefined' && 'title' in process);
 * const platform = isNode ? 'node' : navigator.platform;
 * ```
 *
 * The old Next app's bundler rewrote that bare `process` to its own browser shim, which
 * has a `title` — so xterm concluded it was running in node, every flag came out
 * `false`, and `isMac === false` turned the Mac's Option key into Meta: `Option+ò` sent
 * `ESC ;` instead of `@` on an Italian layout. That app fixed it by overwriting
 * `term._core.browser` (`restoreTerminalPlatform`).
 *
 * The fix is not ported blindly. Vite does not shim `process` for the browser: the
 * built chunk keeps the guard verbatim with `process` a free global, which a browser
 * does not define, so xterm's own detection is right. `platform.build.test.ts` holds it
 * there: it bundles xterm with the app's Vite config and runs it as a Mac browser would.
 * `xtermThinksItIsNode` is the same check at runtime (TerminalView warns in dev if it ever
 * answers `true`), and `detectPlatform` is the answer xterm is expected to reach.
 */

/** The flags xterm's keyboard and selection paths branch on, from the navigator's two strings. Same lists as xterm's `common/Platform.ts`. */
export function detectPlatform(nav: { platform?: string; userAgent: string }): {
  isMac: boolean;
  isWindows: boolean;
  isFirefox: boolean;
} {
  const platform = nav.platform ?? "";
  return {
    isMac: ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(platform),
    isWindows: ["Windows", "Win16", "Win32", "WinCE"].includes(platform),
    isFirefox: nav.userAgent.includes("Firefox"),
  };
}

/**
 * Does xterm, as bundled, believe it is running in node? Reads the platform record
 * xterm hands its keyboard path (`_core.browser`, TypeScript-private, read and never
 * written) off a throwaway terminal. `true` in a browser means the guard above fired
 * and the Option key is broken on a Mac.
 */
export function xtermThinksItIsNode(): boolean {
  const term = new Terminal();
  try {
    const core = (term as unknown as { _core?: { browser?: { isNode?: unknown } } })._core;
    return core?.browser?.isNode === true;
  } finally {
    term.dispose();
  }
}
