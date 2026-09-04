import { describe, it, expect } from "vitest";
import { openAttempts } from "@/cli/openTarget";

const url = "http://localhost:8700/session/x?token=t";

describe("openAttempts", () => {
  it("tries the installed web app first on macOS, then the default browser", () => {
    expect(openAttempts({ platform: "darwin", url, app: "Mojito", browserOnly: false })).toEqual([
      ["open", "-a", "Mojito", url],
      ["open", url],
    ]);
  });

  it("skips the web app on --browser", () => {
    expect(openAttempts({ platform: "darwin", url, app: "Mojito", browserOnly: true })).toEqual([
      ["open", url],
    ]);
  });

  it("skips it when no app name is configured, rather than running `open -a` with none", () => {
    expect(openAttempts({ platform: "darwin", url, app: "", browserOnly: false })).toEqual([
      ["open", url],
    ]);
  });

  // A Chromium PWA is not addressable by name, so there is nothing to try but the browser.
  it("uses xdg-open off macOS, web app or not", () => {
    expect(openAttempts({ platform: "linux", url, app: "Mojito", browserOnly: false })).toEqual([
      ["xdg-open", url],
    ]);
  });
});
