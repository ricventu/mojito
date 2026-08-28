import { describe, it, expect } from "vitest";
import {
  browserPlatform,
  restoreTerminalPlatform,
  type PlatformHost,
} from "@/lib/terminalPlatform";

/**
 * What xterm's own Platform module computes once its `isNode` guard has fired:
 * every flag false, both strings the literal "node". This is the state the
 * bundled app actually runs in, and the one this module exists to undo.
 */
function nodeBrowser(): Record<string, unknown> {
  return {
    isNode: true,
    userAgent: "node",
    platform: "node",
    isFirefox: false,
    isMac: false,
    isIpad: false,
    isIphone: false,
    isWindows: false,
  };
}

const MAC = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel" };

describe("browserPlatform", () => {
  it("recognises a Mac", () => {
    expect(browserPlatform(MAC).isMac).toBe(true);
  });

  it("never reports node — the whole point is that this runs in a browser", () => {
    expect(browserPlatform(MAC).isNode).toBe(false);
    expect(browserPlatform({ userAgent: "node", platform: "node" }).isNode).toBe(false);
  });

  it("recognises the other platforms xterm branches on", () => {
    expect(browserPlatform({ userAgent: "x", platform: "Win32" }).isWindows).toBe(true);
    expect(browserPlatform({ userAgent: "x", platform: "iPhone" }).isIphone).toBe(true);
    expect(browserPlatform({ userAgent: "x", platform: "iPad" }).isIpad).toBe(true);
    expect(browserPlatform({ userAgent: "… Firefox/128.0", platform: "Linux x86_64" }).isFirefox).toBe(true);
  });

  it("keeps the flags mutually honest — a Mac is not Windows", () => {
    const p = browserPlatform(MAC);
    expect(p.isWindows).toBe(false);
    expect(p.isIphone).toBe(false);
    expect(p.isIpad).toBe(false);
  });

  it("carries the navigator's own strings through", () => {
    const p = browserPlatform(MAC);
    expect(p.platform).toBe("MacIntel");
    expect(p.userAgent).toBe(MAC.userAgent);
  });
});

describe("restoreTerminalPlatform", () => {
  it("turns the Option key back into a third-level shift on a Mac", () => {
    // isMac is the single flag the keyboard path reads (`this.browser.isMac` in
    // `_keyDown`, and `_isThirdLevelShift`). False is what sends `ESC + ;` for `@`.
    const term: PlatformHost = { _core: { browser: nodeBrowser() } };

    expect(restoreTerminalPlatform(term, MAC)).toBe(true);
    expect(term._core!.browser!.isMac).toBe(true);
    expect(term._core!.browser!.isNode).toBe(false);
  });

  it("leaves a field it does not know about alone", () => {
    const term: PlatformHost = { _core: { browser: { ...nodeBrowser(), isChromeOS: true } } };

    restoreTerminalPlatform(term, MAC);

    expect(term._core!.browser!.isChromeOS).toBe(true);
  });

  it("does not report a Mac to a terminal that is not on one", () => {
    const term: PlatformHost = { _core: { browser: nodeBrowser() } };

    restoreTerminalPlatform(term, { userAgent: "x", platform: "Win32" });

    expect(term._core!.browser!.isMac).toBe(false);
    expect(term._core!.browser!.isWindows).toBe(true);
  });

  it("declines rather than throws when the seam is gone", () => {
    // A future xterm that drops or renames `_core.browser`: the terminal keeps
    // the behaviour it has, and the mount around this call must survive.
    expect(restoreTerminalPlatform({}, MAC)).toBe(false);
    expect(restoreTerminalPlatform({ _core: {} }, MAC)).toBe(false);
  });
});
