import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Installed standalone the app is full-bleed — layout.tsx asks for `viewport-fit:
// cover` and Apple's `black-translucent` status bar — so the layout viewport is the
// whole screen and the clock and home indicator sit *over* it. Any surface that
// touches an edge and does not pay the matching inset simply has its content under
// the system UI, which is what RIC-257 reported: on an iPhone 11 the board's toolbar
// and the terminal's header both rendered beneath the status bar.
//
// Nothing else in the tree would notice that going wrong. It is CSS, it is invisible
// on a desktop browser and in the node-only test setup alike (both report every inset
// as 0), and it comes back the moment someone rewrites one of these blocks without
// knowing the rule. Hence a test over the real stylesheet, in the shape of
// tests/client/manifest.test.ts.
//
// Comments are stripped up front because several of them quote a brace, which the
// rule matcher below would otherwise read as a rule boundary.
const CSS = readFileSync(join(__dirname, "..", "..", "src", "app", "globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declaration block of one rule, addressed by its exact selector text.
 *
 * Deliberately exact rather than a substring match: `.acc` and `.acc-wrap` are two
 * different rules, and only one of them is the bar sitting on the home indicator.
 */
function block(selector: string): string {
  const rules = CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, sel, body] of rules) {
    if (sel.trim() === selector) return body;
  }
  throw new Error(`no rule for selector ${selector} in globals.css`);
}

describe("safe-area tokens", () => {
  // Aliased in :root rather than spelled out at each call site, so a test can drive
  // the whole layout by overriding four values — and so the `0px` fallback, which is
  // what keeps the rules valid where the keyword is unknown, is written once.
  it.each([
    ["--sat", "top"],
    ["--sar", "right"],
    ["--sab", "bottom"],
    ["--sal", "left"],
  ])("%s aliases the %s inset with a 0px fallback", (token, edge) => {
    expect(CSS).toContain(`${token}: env(safe-area-inset-${edge}, 0px)`);
  });
});

describe("surfaces that touch a screen edge", () => {
  // `.term-root` and not `.term-head`: the header is unmounted while the virtual
  // keyboard is up (see TerminalView), so the inset has to live on something that is
  // always there or the terminal slides back under the status bar mid-typing.
  it.each([
    [".page", "--sat"],                 // the board
    [".term-root", "--sat"],            // the terminal, header or no header
    [".docs-head", "--sat"],            // the docs overlay's own header
    [".alert-layer", "--sat"],          // the fixed needs-input banner
    [".active-filters", "--sat"],       // sticky, so it pins *below* the clock
    [".gate-screen", "--sat"],          // the token gate is the whole page
  ])("%s pays the top inset via %s", (selector, token) => {
    expect(block(selector)).toContain(token);
  });

  it.each([
    [".page", "--sab"],                 // clears the home indicator
    [".acc", "--sab"],                  // the terminal's bottom-most bar
    [".docs-scroll", "--sab"],
    [".sheet", "--sab"],
    [".gate-screen", "--sab"],
  ])("%s pays the bottom inset via %s", (selector, token) => {
    expect(block(selector)).toContain(token);
  });

  // RIC-253 retired the bottom nav, so the page's bottom is the bare inset: the 64px
  // that used to clear the bar would now be a gap under the last card. The board has no
  // fixed bottom surface left, which is also why `.nav` is gone from the lists above.
  it("clears the home indicator and nothing else", () => {
    expect(block(".page")).toMatch(/padding-bottom:\s*var\(--sab\)/);
  });

  // Landscape on a notched phone puts the notch on one side, so left/right are not
  // always 0 — every full-bleed container pays them too.
  it.each([".page", ".term-root", ".docs-root", ".sheet"])(
    "%s pays the horizontal insets",
    (selector) => {
      const body = block(selector);
      expect(body).toContain("--sal");
      expect(body).toContain("--sar");
    },
  );

  // While the keyboard is up the terminal is sized to the band above it, whose bottom
  // edge is the keyboard and not the home indicator — paying the inset there would
  // spend ~2 of the ~13 visible rows on nothing.
  it("drops the terminal's bottom inset while the keyboard is up", () => {
    expect(block(".term-root.kbd .acc")).toMatch(/padding-bottom:\s*8px/);
  });
});
