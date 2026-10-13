import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(__dirname, "..", "..", "src", "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
function block(selector: string): string {
  // The first rule's "selector" would otherwise swallow the `@import`/`@tailwind` statements before it.
  for (const [, sel, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (sel.split(";").pop()!.trim() === selector) return body;
  throw new Error(`no rule for ${selector}`);
}

describe("git graph styles", () => {
  // layoutGraph answers colours 0..PALETTE_SIZE-1 and the view paints var(--graph-N).
  it("declares one token per palette colour", () => {
    const root = block(":root");
    for (let i = 0; i < 8; i++) expect(root).toContain(`--graph-${i}:`);
  });

  // The view is a .docs-root overlay (z-index 120); a plain .sheet-backdrop (100) would
  // open *under* it and look like the tap did nothing.
  it("lifts the commit sheet above the overlay it opens from", () => {
    const z = Number(/z-index:\s*(\d+)/.exec(block(".sheet-backdrop.git-sheet"))?.[1]);
    expect(z).toBeGreaterThan(120);
  });
});
