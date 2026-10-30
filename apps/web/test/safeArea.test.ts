import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The app is full-bleed — `viewport-fit=cover` and Apple's `black-translucent` status bar
// — so the layout viewport is the whole screen and the clock and the home indicator sit
// *over* it. Any surface that touches an edge and does not pay the matching inset has its
// content under the system UI (RIC-257: the toolbar and the terminal header on an
// iPhone 11). It is invisible on a desktop and in the node-only test setup alike, so
// nothing else in the tree would notice it going away: hence a test over the real files.
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
// Comments are stripped so a comment quoting a token cannot satisfy an assertion.
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("viewport", () => {
  const html = read("index.html");

  it("asks for the full screen", () => {
    expect(html).toContain("viewport-fit=cover");
  });

  it("uses the translucent status bar", () => {
    expect(html).toContain("black-translucent");
  });
});

describe("safe-area tokens", () => {
  const css = read("src/index.css");

  // Aliased once in :root so the `0px` fallback is written in one place and a desktop
  // browser can render the phone geometry by overriding four values.
  it.each([
    ["--sat", "top"],
    ["--sar", "right"],
    ["--sab", "bottom"],
    ["--sal", "left"],
  ])("%s aliases the %s inset with a 0px fallback", (token, edge) => {
    expect(css).toContain(`${token}: env(safe-area-inset-${edge}, 0px)`);
  });
});

describe("surfaces that touch an edge pay for it", () => {
  it.each([
    ["src/components/board/Toolbar.tsx", "var(--sat)"],
    ["src/components/terminal/TerminalPage.tsx", "var(--sat)"],
    ["src/components/terminal/AccessoryBar.tsx", "var(--sab)"],
    ["src/components/settings/SettingsPage.tsx", "var(--sat)"],
    ["src/components/sidebar/SessionSidebar.tsx", "var(--sat)"],
    ["src/components/sidebar/SessionSidebar.tsx", "var(--sal)"],
    ["src/components/sidebar/SessionSidebar.tsx", "var(--sab)"],
    ["src/components/git/GitGraphPage.tsx", "var(--sat)"],
    ["src/components/git/GitGraphPage.tsx", "var(--sab)"],
    ["src/components/git/CommitSheet.tsx", "var(--sar)"],
    ["src/components/git/CommitSheet.tsx", "var(--sal)"],
    ["src/components/git/CommitSheet.tsx", "var(--sab)"],
    ["src/components/docs/DocsPage.tsx", "var(--sat)"],
    ["src/components/docs/DocsPage.tsx", "var(--sar)"],
    ["src/components/docs/DocsPage.tsx", "var(--sab)"],
    ["src/components/docs/DocsPage.tsx", "var(--sal)"],
    ["src/components/git/DiffView.tsx", "var(--sab)"],
  ])("%s spends %s", (file, token) => {
    expect(code(file)).toContain(token);
  });

  // The docked sidebar is one fixed column for every page (AppShell): it touches the top,
  // left and bottom edges itself, and every page starts after it (`--dock-width`).
  it.each(["var(--sat)", "var(--sal)", "var(--sab)"])("the docked sidebar spends %s", (token) => {
    const docked = code("src/components/sidebar/SessionSidebar.tsx").match(/<aside[^>]*className="([^"]*)"/);
    expect(docked?.[1]).toContain(`[${token}]`);
  });

  it.each([
    "src/components/board/Board.tsx",
    "src/components/terminal/TerminalPage.tsx",
    "src/components/git/GitGraphPage.tsx",
    "src/components/docs/DocsPage.tsx",
    "src/components/settings/SettingsPage.tsx",
  ])("%s starts after a docked sidebar", (file) => {
    expect(code(file)).toContain("[var(--dock-width)]");
  });

  // The "terminated" panel mounts no accessory bar, so on a touch screen nothing else
  // pays the home indicator there: the root must keep its bottom inset in that branch.
  it("the terminal root pays --sab whenever the accessory bar is not mounted", () => {
    expect(code("src/components/terminal/TerminalPage.tsx")).toMatch(
      /gone\s*\?\s*"pb-\[var\(--sab\)\]"\s*:\s*"pb-\[var\(--sab\)\] pointer-coarse:pb-0"/,
    );
  });
});
