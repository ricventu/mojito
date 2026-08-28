/**
 * Tell the browser terminal which platform it is actually running on.
 *
 * ## Why this is needed at all
 *
 * xterm decides `isMac`/`isWindows`/`isFirefox`/… **once, at module load**, in
 * `common/Platform.ts`:
 *
 * ```ts
 * export const isNode = (typeof process !== 'undefined' && 'title' in process);
 * const platform = isNode ? 'node' : navigator.platform;
 * export const isMac = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'].includes(platform);
 * ```
 *
 * That guard is meant to keep the module importable from node. In a **bundled**
 * app it does the opposite: the bare `process` reference is a free variable, so
 * the bundler rewrites it to its own browser shim — and that shim has a `title`
 * ("browser"). So `isNode` is **true inside the browser**, `platform` becomes
 * the string `"node"`, and every platform flag xterm owns comes out `false`.
 * Confirmed in the built client chunk, where the check survives verbatim as
 * `np = "u" > typeof x.default && "title" in x.default` with `x` an imported
 * module rather than the (absent) global.
 *
 * ## What that breaks
 *
 * `isMac === false` turns the **Option key into Meta**. `evaluateKeyboardEvent`
 * gates its "Alt = ESC prefix" branch on `(!isMac || macOptionIsMeta) && ev.altKey`,
 * so on a Mac it takes the branch it was written to skip, and
 * `_isThirdLevelShift` — the escape hatch that hands the keystroke back to the
 * browser so the layout can compose it — returns false as well. The event is
 * cancelled and `ESC + <US-layout key>` is sent instead of the character.
 *
 * On an Italian layout that is every character worth typing, since all of them
 * are Option combinations. Measured in the browser, before and after this fix:
 *
 * ```
 * Option+ò  →  "\x1b;"   instead of  "@"
 * Option+à  →  "\x1b'"   instead of  "#"
 * Option+è  →  "\x1b["   instead of  "["
 * Option++  →  "\x1b]"   instead of  "]"
 * ```
 *
 * Note `\x1b[`: a CSI introducer. tmux and claude's TUI swallow the following
 * bytes as an escape sequence, which is why the reported symptom was "nothing
 * happens at all" rather than a wrong character appearing.
 *
 * ## Why the fix is a poke at `_core`
 *
 * Nothing public reaches this. `macOptionIsMeta` is already `false` and cannot
 * help — the broken branch is entered through `!isMac`, not through the option.
 * The one seam is `CoreBrowserTerminal.browser`, a plain public field holding
 * the Platform module, which is what `_keyDown` and `_isThirdLevelShift` read
 * (`this.browser.isMac`). Replacing it per terminal restores the upstream
 * behaviour exactly, with no key handling of our own: Option+letter composes
 * natively again, and Option+arrow / Option+Backspace keep sending the word-wise
 * sequences they always did (verified: `\x1b[1;3D`, `ESC DEL`).
 *
 * Doing it this way rather than intercepting the keys in
 * `attachCustomKeyEventHandler` also avoids the trap in that approach: xterm
 * would still run its own `keypress` path, so the day its detection is fixed
 * every such character would arrive **twice**. Here a correct `isMac` makes this
 * assignment a no-op instead.
 *
 * It is deliberately best-effort. `_core` is TypeScript-private (the property
 * name survives minification, and is read here, never redefined); if a future
 * xterm drops or renames it, the terminal simply keeps the behaviour it has
 * today rather than failing the mount — this runs alongside the socket, the
 * resize handlers and the touch scroll, same as `attachWebglRenderer`.
 *
 * What it does **not** fix: `SelectionService` reads the Platform module
 * directly rather than this field, so `macOptionClickForcesSelection` is still
 * dead and the Mac's force-selection gesture is **Shift+drag**, the non-Mac
 * branch of `shouldForceSelection` — not the Option+drag `terminalOptions.ts`
 * describes. Same root cause, no instance-level seam.
 *
 * The pure half is the usual split (cf. `resolveInitialToken` ÷ `useToken`):
 * `browserPlatform` is a function of the navigator's two strings, so the whole
 * rule is testable in the node-only vitest setup.
 */

/** The subset of `navigator` xterm's own detection reads. */
export interface PlatformNavigator {
  userAgent: string;
  platform: string;
}

/** The shape of `CoreBrowserTerminal.browser` (xterm's `IBrowser`). */
export interface BrowserPlatform {
  isNode: boolean;
  userAgent: string;
  platform: string;
  isFirefox: boolean;
  isMac: boolean;
  isIpad: boolean;
  isIphone: boolean;
  isWindows: boolean;
}

/**
 * The platform flags xterm would have computed had it not mistaken the bundler's
 * `process` shim for node. Same lists and same tests as `common/Platform.ts`,
 * on purpose: this is a repair, not a second opinion.
 */
export function browserPlatform(nav: PlatformNavigator): BrowserPlatform {
  const { userAgent, platform } = nav;
  return {
    isNode: false,
    userAgent,
    platform,
    isFirefox: userAgent.includes("Firefox"),
    isMac: ["Macintosh", "MacIntel", "MacPPC", "Mac68K"].includes(platform),
    isIpad: platform === "iPad",
    isIphone: platform === "iPhone",
    isWindows: ["Windows", "Win16", "Win32", "WinCE"].includes(platform),
  };
}

/** Structural stand-in for the terminal, so the poke is testable without xterm. */
export interface PlatformHost {
  _core?: { browser?: Record<string, unknown> };
}

/**
 * Overwrite one terminal's platform flags with the real ones.
 *
 * Takes an `object` rather than `Terminal` so the call site needs no cast — the
 * field being reached for is private to xterm's types and absent from the public
 * class, and the shape is checked here instead. Returns whether it could:
 * `false` means the field was not there (a future xterm), and the caller has
 * nothing to do about it.
 */
export function restoreTerminalPlatform(term: object, nav: PlatformNavigator): boolean {
  const host = term as PlatformHost;
  const browser = host._core?.browser;
  if (!browser) return false;
  // Spread the existing object first: only the flags below are known to be
  // wrong, and a field xterm adds later should survive untouched.
  host._core!.browser = { ...browser, ...browserPlatform(nav) };
  return true;
}
