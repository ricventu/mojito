import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The installed app (Safari "Add to Dock" / "Add to Home Screen", a Chromium install) is
// tied to this file, and its failures have no other symptom: a renamed icon silently
// un-installs the app in Chromium, and a changed `id` makes every installed copy a
// stranger to the manifest it was installed from (the Mac's Dock app was installed from
// v1's, `manifestId = http://localhost:8700/`). Hence a test over the real files.
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string }[];
};

describe("manifest", () => {
  it("keeps v1's identity", () => {
    expect(manifest).toMatchObject({ id: "/", name: "Mojito", start_url: "/", scope: "/", display: "standalone" });
  });

  // Chromium's install criteria: a 192 and a 512 PNG.
  it.each(["192x192", "512x512"])("lists a %s png", (sizes) => {
    expect(manifest.icons).toContainEqual(expect.objectContaining({ sizes, type: "image/png" }));
  });

  it.each(manifest.icons.map((icon) => icon.src))("%s exists", (src) => {
    expect(existsSync(join(root, "public", src))).toBe(true);
  });
});

describe("index.html", () => {
  const html = read("index.html");

  it.each(["/manifest.webmanifest", "/apple-touch-icon.png"])("links %s, which exists", (href) => {
    expect(html).toContain(`href="${href}"`);
    expect(existsSync(join(root, "public", href))).toBe(true);
  });
});
