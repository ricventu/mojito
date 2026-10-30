import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitError, gitRunner } from "../../src/git/git";

let dir: string;
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  dir = mkdtempSync(join(tmpdir(), "mojito-git-"));
});
afterAll(() => {
  for (const [key, value] of [["GIT_CONFIG_GLOBAL", saved.global], ["GIT_CONFIG_NOSYSTEM", saved.nosystem]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("gitRunner", () => {
  it("answers a timeout in words, with no exit code", async () => {
    // `hash-object --stdin` waits on a stdin nobody closes, so only the timeout ends it.
    const err = await gitRunner(200)(["hash-object", "--stdin"], dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).output).toBe("git did not answer within 0.2 s");
    expect((err as GitError).exitCode).toBeNull();
  });

  it("keeps git's own output and exit code for a real failure", async () => {
    const err = await gitRunner(10_000)(["rev-parse", "HEAD"], dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).output).toMatch(/not a git repository/);
    expect((err as GitError).exitCode).toBe(128);
  });
});
