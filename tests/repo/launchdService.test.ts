import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The macOS LaunchAgent, in the shape of tests/cli/packaging.test.ts: the plist it writes
// lives outside the repo and launchd fails silently, so nothing in the tree would notice.
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const isExecutable = (rel: string) => (statSync(join(ROOT, rel)).mode & 0o111) !== 0;

const run = read("scripts/launchd-run.sh");
const service = read("scripts/launchd-service.sh");
const makefile = read("Makefile");

describe("launchd service", () => {
  it("ships both scripts executable", () => {
    expect(isExecutable("scripts/launchd-run.sh")).toBe(true);
    expect(isExecutable("scripts/launchd-service.sh")).toBe(true);
  });

  // Wrapped in caffeinate, the supervisor would not be the job's process: launchd's
  // SIGTERM would miss it, its shutdown would never run, and the server — its own process
  // group — would be left holding the port.
  it("execs the supervisor itself and has caffeinate watch it", () => {
    expect(run).toMatch(/^exec node \.\/scripts\/prod-supervisor\.mjs$/m);
    expect(run).toContain("caffeinate -is -w $$");
  });

  // Exporting .env.local wholesale would put LINEAR_API_KEY in the server's environment
  // before its own load, where registerEnvFileKeys cannot see it arrive (RIC-207).
  it("reads only the port out of .env.local, in a subshell", () => {
    expect(run).toMatch(/MOJITO_PORT=\$\(\n\s*set -a/);
    expect(run).not.toMatch(/^set -a/m);
  });

  // A worktree has no .env.local and can be removed under a running service.
  it("bakes the main checkout, not whichever worktree it was run from", () => {
    expect(service).toContain("--git-common-dir");
  });

  it("is a user LaunchAgent, never a system daemon", () => {
    expect(service).toContain("Library/LaunchAgents");
    expect(service).toContain('DOMAIN="gui/$(id -u)"');
  });

  it("has the make targets", () => {
    for (const t of ["install", "uninstall", "restart", "status", "logs"]) {
      expect(makefile).toMatch(new RegExp(`^service-${t}:`, "m"));
    }
  });
});
