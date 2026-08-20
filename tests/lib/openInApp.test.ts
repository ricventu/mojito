import { describe, it, expect } from "vitest";
import { vscodeUrl, warpUrl } from "@/lib/openInApp";

describe("warpUrl", () => {
  it("opens a new tab at the directory", () => {
    expect(warpUrl("/Users/ric/code/mojito")).toBe(
      "warp://action/new_tab?path=%2FUsers%2Fric%2Fcode%2Fmojito",
    );
  });

  it("encodes a path with spaces and other query-hostile characters", () => {
    expect(warpUrl("/Users/ric/My Code/a&b")).toBe(
      "warp://action/new_tab?path=%2FUsers%2Fric%2FMy%20Code%2Fa%26b",
    );
  });

  it("drops a trailing slash rather than sending an empty last segment", () => {
    expect(warpUrl("/Users/ric/code/mojito/")).toBe(warpUrl("/Users/ric/code/mojito"));
  });
});

describe("vscodeUrl", () => {
  it("opens the directory as a folder — trailing slash included", () => {
    expect(vscodeUrl("/Users/ric/code/mojito")).toBe("vscode://file/Users/ric/code/mojito/");
  });

  it("encodes each segment but keeps the separators, which are the uri's own path", () => {
    expect(vscodeUrl("/Users/ric/My Code/a#b")).toBe("vscode://file/Users/ric/My%20Code/a%23b/");
  });

  it("does not double the trailing slash of a path that already has one", () => {
    expect(vscodeUrl("/Users/ric/code/mojito/")).toBe("vscode://file/Users/ric/code/mojito/");
  });
});

// A worktree is the case that matters: a ticket session runs in
// .claude/worktrees/<ticket>-<slug>, which is where "open this in my editor" has to land.
describe("both, on a worktree path", () => {
  const wt = "/Users/ric/code/mojito/.claude/worktrees/RIC-226-toolbar";
  it("points at the worktree, not the repo root", () => {
    expect(warpUrl(wt)).toContain(encodeURIComponent(wt));
    expect(vscodeUrl(wt)).toBe(`vscode://file${wt}/`);
  });
});

describe("no link at all", () => {
  // The header renders these actions only when there is a url, so "" is how a session
  // with nothing usable to open opts out — a relative path would resolve against
  // whatever directory the receiving app considers current.
  for (const cwd of ["", "   ", "code/mojito", "~/code/mojito", "./x"]) {
    it(`refuses ${JSON.stringify(cwd)}`, () => {
      expect(warpUrl(cwd)).toBe("");
      expect(vscodeUrl(cwd)).toBe("");
    });
  }

  it("trims surrounding whitespace off a real path", () => {
    expect(warpUrl("  /tmp/x  ")).toBe(warpUrl("/tmp/x"));
    expect(vscodeUrl("  /tmp/x  ")).toBe(vscodeUrl("/tmp/x"));
  });
});
