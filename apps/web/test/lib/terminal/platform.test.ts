import { describe, expect, it } from "vitest";
import { detectPlatform, xtermThinksItIsNode } from "@/lib/terminal/platform";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15";
const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

describe("detectPlatform", () => {
  it("recognises a Mac", () => {
    expect(detectPlatform({ platform: "MacIntel", userAgent: MAC_UA })).toEqual({
      isMac: true,
      isWindows: false,
      isFirefox: false,
    });
  });

  it("recognises Windows", () => {
    expect(detectPlatform({ platform: "Win32", userAgent: "x" })).toMatchObject({ isWindows: true, isMac: false });
  });

  it("recognises Firefox from the user agent", () => {
    expect(detectPlatform({ platform: "Linux x86_64", userAgent: FIREFOX_UA })).toMatchObject({ isFirefox: true });
  });

  it("answers no platform at all when the navigator does not name one", () => {
    expect(detectPlatform({ userAgent: "x" })).toEqual({ isMac: false, isWindows: false, isFirefox: false });
  });
});

describe("xtermThinksItIsNode", () => {
  // Under vitest this *is* node (`process.title` exists), so xterm's own guard fires.
  // The assertion is that the probe reaches xterm's real flag: if a future xterm moves
  // `_core.browser`, this goes red rather than the probe silently answering false.
  it("reads xterm's own platform decision", () => {
    expect(xtermThinksItIsNode()).toBe(true);
  });
});
