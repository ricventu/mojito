import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The manifest is a static file in public/, not code, so nothing else in the tree
// would notice it going wrong — and every way it goes wrong has the same symptom:
// the browser silently stops offering "Install", with no console error and no
// visible change to the running app. Hence a test over the real file (RIC-250).
const PUBLIC = join(__dirname, "..", "..", "public");
const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8"));

// Chromium's own list (web.dev/articles/install-criteria): short_name or name,
// start_url, a display in this set, and icons including a 192px and a 512px.
// A service worker is deliberately absent from it — Chrome dropped that clause,
// which is why public/sw.js can stay the no-op it is.
const INSTALLABLE_DISPLAYS = ["fullscreen", "standalone", "minimal-ui", "window-controls-overlay"];

const sizeList = (icon: { sizes?: string }) => (icon.sizes ?? "").split(/\s+/).filter(Boolean);
const hasSquare = (px: number) => manifest.icons.some((i: { sizes?: string }) => sizeList(i).includes(`${px}x${px}`));

describe("manifest.webmanifest", () => {
  it("names the app", () => {
    expect(manifest.name || manifest.short_name).toBeTruthy();
  });

  it("declares a start_url and a scope", () => {
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  // `id` pins the installed app's identity to something other than start_url, so a
  // future change to start_url updates the install in place instead of reading as a
  // second, unrelated app the user has to install again.
  it("pins an id independent of start_url", () => {
    expect(manifest.id).toBeTruthy();
  });

  it("uses a display mode Chromium treats as installable", () => {
    expect(INSTALLABLE_DISPLAYS).toContain(manifest.display);
  });

  // Both, not either: Chromium wants a 192 *and* a 512. Having only the 192 is the
  // state this ticket found the manifest in, and it is why desktop Chrome offered
  // nothing even on localhost, where the http origin is otherwise trusted.
  it("ships both icon sizes Chromium requires", () => {
    expect(hasSquare(192)).toBe(true);
    expect(hasSquare(512)).toBe(true);
  });

  // Android crops a maskable icon to the launcher's shape. Declaring it means
  // promising the artwork clears the 80% safe circle — icon.svg is drawn to that.
  it("offers the raster icons as maskable as well as any", () => {
    const raster = manifest.icons.filter((i: { type?: string }) => i.type === "image/png");
    expect(raster.length).toBeGreaterThan(0);
    for (const icon of raster) {
      expect(icon.purpose?.split(/\s+/)).toEqual(expect.arrayContaining(["any", "maskable"]));
    }
  });

  // The case with no other symptom at all: rename or move an icon and the manifest
  // still parses, still lists a 192 and a 512, and installability quietly dies.
  it("points every icon at a file that exists", () => {
    for (const icon of manifest.icons as Array<{ src: string }>) {
      expect(icon.src.startsWith("/"), `${icon.src} must be root-relative`).toBe(true);
      expect(existsSync(join(PUBLIC, icon.src)), `${icon.src} is missing from public/`).toBe(true);
    }
  });

  // iOS ignores the manifest for the home-screen icon and reads this file via the
  // <link rel="apple-touch-icon"> layout.tsx emits. It is not a manifest entry, so
  // the check above cannot cover it.
  it("ships the apple-touch-icon iOS uses instead of the manifest icons", () => {
    expect(existsSync(join(PUBLIC, "apple-touch-icon.png"))).toBe(true);
  });

  // Both colours paint chrome the user sees before any of Mojito's CSS loads — the
  // splash ground and the task-switcher bar — so a stale value here shows up as a
  // flash of the wrong dark against --bg.
  it("matches the app's own background token", () => {
    expect(manifest.background_color).toBe("#0d0f11");
    expect(manifest.theme_color).toBe("#0d0f11");
  });
});
