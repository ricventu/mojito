import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// A stretched button (`after:absolute after:inset-0`) covers its card, so what must stay
// clickable on top of it is raised with `relative z-10`. Unless the card is its own stacking
// context, that z-10 competes in the page's: the sticky toolbars are `z-10` too and come
// earlier in the DOM, so a scrolled card's raised link and ✕ were painted over the board's
// header (RIC-564). `isolate` keeps the card's z-index inside the card. Invisible in the
// node-only test setup, hence a test over the real files.
const root = join(__dirname, "..");
const components = join(root, "src/components");
// Comments are stripped so a comment quoting a token cannot satisfy an assertion.
const code = (path: string) =>
  readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "ui" ? [] : tsxFiles(path);
    return e.name.endsWith(".tsx") ? [path] : [];
  });
}

const stretched = tsxFiles(components).filter((f) => /after:absolute\b[^"]*after:inset-0/.test(code(f)));

describe("stretched cards", () => {
  it("exist (the guard below is not vacuous)", () => {
    expect(stretched.length).toBeGreaterThan(0);
  });

  it.each(stretched.map((f) => [relative(root, f), f]))("%s isolates its stacking context", (_name, file) => {
    expect(code(file)).toMatch(/\bisolate\b/);
  });
});
