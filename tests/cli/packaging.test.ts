import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The CLI's packaging, in the shape of tests/repo/packaging.test.ts: nothing in the tree
// notices any of this going wrong, because the launcher `make install-cli` writes lives
// outside the repo and only a human running `mojito` would find out.
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const isExecutable = (rel: string) => (statSync(join(ROOT, rel)).mode & 0o111) !== 0;

const wrapper = read("bin/mojito");
const makefile = read("Makefile");

describe("mojito CLI packaging", () => {
  it("ships the wrapper executable, since it is what the launcher execs", () => {
    expect(isExecutable("bin/mojito")).toBe(true);
  });

  it("runs the TypeScript entry point through the repo's own tsx", () => {
    expect(wrapper).toContain("node_modules/.bin/tsx");
    expect(wrapper).toContain("bin/mojito.ts");
  });

  it("has an install target", () => {
    expect(makefile).toMatch(/^install-cli:/m);
  });

  // A worktree has no .env.local (RIC-207) and can be removed at any time, so the baked
  // path has to be the main checkout — which is what --git-common-dir answers.
  it("bakes the main checkout into the launcher, not whichever worktree it was run from", () => {
    const target = makefile.match(/^install-cli:[\s\S]*?(?=^\S|\Z)/m)?.[0] ?? "";
    expect(target).toContain("--git-common-dir");
  });

  // The Makefile declares .SHELLFLAGS, which macOS's GNU Make 3.81 ignores outright — so
  // a failing command mid-recipe is stepped over and the target still exits 0.
  it("checks its own failures rather than leaning on set -e", () => {
    const target = makefile.match(/^install-cli:[\s\S]*?(?=^\S|\Z)/m)?.[0] ?? "";
    expect(target).toMatch(/\|\| exit 1|if ! /);
  });
});
