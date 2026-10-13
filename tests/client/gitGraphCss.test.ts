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

  // The sheet sits inside .docs-root's own stacking context, so this is belt-and-braces:
  // the rule keeps it above any positioned descendant of the overlay (z-index 120).
  it("lifts the commit sheet above the overlay it opens from", () => {
    const z = Number(/z-index:\s*(\d+)/.exec(block(".sheet-backdrop.git-sheet"))?.[1]);
    expect(z).toBeGreaterThan(120);
  });

  // Ref chips must give way to the commit subject: a `flex: none` strip of ~190px chips left
  // the subject zero width on a phone, and a bare text node ignores text-overflow.
  it("lets ref chips shrink and truncate instead of starving the subject", () => {
    expect(block(".git-refs")).not.toMatch(/flex:\s*none/);
    expect(block(".git-refs")).toMatch(/min-width:\s*0/);
    expect(block(".git-ref-name")).toContain("text-overflow: ellipsis");
    expect(block(".git-ref-name")).toMatch(/min-width:\s*0/);
  });
});
