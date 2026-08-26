import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Everything asserted here is packaging rather than code, so nothing in the tree
// would notice it going wrong — and each one fails silently rather than loudly
// (RIC-240, the npm -> pnpm migration):
//
//   two lockfiles      Turbopack picks the project root by finding a lockfile, and
//                      `npm ci` on the Linux deploy box would take the stale one.
//   no allowBuilds     pnpm 10+ skips install scripts unless the package is named.
//                      Without node-pty's there is no pty binding at all; without
//                      esbuild's, tsx cannot run server.ts or a single test.
//   no pre/post hooks  `predev`/`prestart` are the only thing that puts the +x back
//                      on node-pty's spawn-helper. pnpm's default for this has moved
//                      between majors, so the repo pins it.
//   an npm call        one `npm install` anywhere writes a second lockfile and the
//                      two layouts fight — which is exactly how RIC-227 lost a server.
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const pkg = JSON.parse(read("package.json"));

// pnpm-workspace.yaml is a handful of hand-written lines, so it is scanned rather
// than parsed: a YAML dependency would have to be a real dependency of the app.
const workspace = read("pnpm-workspace.yaml");
const setting = (key: string) => workspace.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"))?.[1];
const allowsBuild = (dep: string) =>
  new RegExp(`^allowBuilds:$[\\s\\S]*?^\\s+${dep.replace(".", "\\.")}:\\s*true$`, "m").test(workspace);

const isExecutable = (rel: string) => (statSync(join(ROOT, rel)).mode & 0o111) !== 0;

describe("package manager", () => {
  it("keeps exactly one lockfile at the root", () => {
    expect(existsSync(join(ROOT, "pnpm-lock.yaml"))).toBe(true);
    expect(existsSync(join(ROOT, "package-lock.json"))).toBe(false);
    expect(existsSync(join(ROOT, "yarn.lock"))).toBe(false);
  });

  it("pins pnpm as the package manager", () => {
    expect(pkg.packageManager).toMatch(/^pnpm@/);
  });

  // The two that need to run, and the only two: both are load-bearing at boot.
  it("allows the install scripts node-pty and esbuild need", () => {
    expect(allowsBuild("node-pty")).toBe(true);
    expect(allowsBuild("esbuild")).toBe(true);
  });

  it("pins pre/post scripts on rather than inheriting pnpm's default", () => {
    expect(setting("enablePrePostScripts")).toBe("true");
  });

  it("runs no package manager from inside a script", () => {
    for (const [name, body] of Object.entries(pkg.scripts as Record<string, string>)) {
      expect(`${name}: ${body}`).not.toMatch(/\b(npm|yarn)\b/);
    }
  });
});

describe("shell scripts the app depends on", () => {
  // src/server/worktree.ts looks for this exact path and runs it in every worktree
  // it creates; a missing or non-executable file degrades to a launch-time warning
  // and a worktree with no dependencies in it.
  it("ships an executable init-worktree.sh where worktree.ts looks for it", () => {
    expect(existsSync(join(ROOT, "scripts/init-worktree.sh"))).toBe(true);
    expect(isExecutable("scripts/init-worktree.sh")).toBe(true);
  });

  it("ships an executable fix-pty-perms.sh, and wires it to both lifecycle hooks", () => {
    expect(isExecutable("scripts/fix-pty-perms.sh")).toBe(true);
    expect(pkg.scripts.predev).toContain("scripts/fix-pty-perms.sh");
    expect(pkg.scripts.prestart).toContain("scripts/fix-pty-perms.sh");
  });
});
