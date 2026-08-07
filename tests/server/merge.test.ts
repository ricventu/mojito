import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mergeTicketBranch, type GitRun, type CliRun } from "@/server/merge";

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const run = gitAvailable() ? describe : describe.skip;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// Real git fixture: a repo on `main` with one commit, plus a linked worktree
// checked out on branch `ric-46` (also one commit ahead of main's tip).
// Config is set per-repo so the suite doesn't depend on host git config.
function makeFixture(): { root: string; repoRoot: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "mojito-merge-"));
  const repoRoot = join(root, "repo");
  mkdirSync(repoRoot);
  git(repoRoot, ["init", "-b", "main"]);
  git(repoRoot, ["config", "user.email", "mojito-test@example.com"]);
  git(repoRoot, ["config", "user.name", "Mojito Test"]);
  writeFileSync(join(repoRoot, "base.txt"), "base\n");
  writeFileSync(join(repoRoot, "shared.txt"), "line1\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "--no-gpg-sign", "-m", "init"]);

  const worktree = join(root, "wt");
  git(repoRoot, ["worktree", "add", worktree, "-b", "ric-46"]);

  return { root, repoRoot, worktree };
}

run("mergeTicketBranch (real git fixtures)", () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop();
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  it("fast-forwards cleanly when main hasn't moved", async () => {
    const { root, repoRoot, worktree } = makeFixture();
    roots.push(root);
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "add feature"]);
    const wtHead = git(worktree, ["rev-parse", "HEAD"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" });

    expect(outcome.status).toBe("merged");
    expect(git(repoRoot, ["rev-parse", "HEAD"])).toBe(wtHead);
  });

  it("rebases cleanly when main has advanced on a disjoint file", async () => {
    const { root, repoRoot, worktree } = makeFixture();
    roots.push(root);
    writeFileSync(join(worktree, "wt-file.txt"), "wt change\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "wt change"]);

    writeFileSync(join(repoRoot, "main-file.txt"), "main change\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "--no-gpg-sign", "-m", "main change"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" });

    expect(outcome.status).toBe("merged");
    if (outcome.status === "merged") {
      expect(outcome.commit).toBe(git(repoRoot, ["rev-parse", "--short", "HEAD"]));
    }
    expect(existsSync(join(repoRoot, "wt-file.txt"))).toBe(true);
    expect(existsSync(join(repoRoot, "main-file.txt"))).toBe(true);
  });

  it("aborts a conflicting rebase and leaves the worktree clean", async () => {
    const { root, repoRoot, worktree } = makeFixture();
    roots.push(root);
    writeFileSync(join(worktree, "shared.txt"), "wt version\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "wt edits shared"]);

    writeFileSync(join(repoRoot, "shared.txt"), "main version\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "--no-gpg-sign", "-m", "main edits shared"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" });

    expect(outcome.status).toBe("conflict");
    expect(git(worktree, ["status", "--porcelain"])).toBe("");
    const rebaseMergePath = git(worktree, ["rev-parse", "--git-path", "rebase-merge"]);
    const rebaseApplyPath = git(worktree, ["rev-parse", "--git-path", "rebase-apply"]);
    expect(existsSync(resolve(worktree, rebaseMergePath))).toBe(false);
    expect(existsSync(resolve(worktree, rebaseApplyPath))).toBe(false);
  });

  it("errors when the repo root isn't on the default branch", async () => {
    const { root, repoRoot, worktree } = makeFixture();
    roots.push(root);
    git(worktree, ["commit", "--allow-empty", "--no-gpg-sign", "-m", "wt commit"]);
    git(repoRoot, ["checkout", "-b", "other"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" });

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.detail).toContain("other");
  });
});

describe("mergeTicketBranch (mr mode, faked run/runCli)", () => {
  it("pushes with force-with-lease then creates a PR, scraping the URL from fake stdout", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const fakeRun: GitRun = async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { stdout: "ric-46\n", stderr: "" };
      if (args[0] === "remote" && args.length === 1) return { stdout: "origin\n", stderr: "" };
      if (args[0] === "fetch") return { stdout: "", stderr: "" };
      if (args[0] === "symbolic-ref") throw Object.assign(new Error("no origin/HEAD"), { stderr: "fatal: no such ref" });
      if (args[0] === "rev-parse" && args[1] === "--verify") return { stdout: "deadbeef\n", stderr: "" };
      if (args[0] === "rebase") return { stdout: "", stderr: "" };
      if (args[0] === "push") return { stdout: "", stderr: "" };
      if (args[0] === "remote" && args[1] === "get-url") return { stdout: "git@github.com:acme/repo.git\n", stderr: "" };
      throw new Error(`unexpected git ${args.join(" ")}`);
    };

    const cliCalls: { cmd: string; args: string[]; cwd: string }[] = [];
    const fakeCli: CliRun = async (cmd, args, cwd) => {
      cliCalls.push({ cmd, args, cwd });
      return { stdout: "Created PR: https://github.com/acme/repo/pull/42\n" };
    };

    const outcome = await mergeTicketBranch({ worktree: "/fake/wt", repoRoot: "/fake/repo", mode: "mr" }, fakeRun, fakeCli);

    expect(outcome).toEqual({ status: "mr-created", url: "https://github.com/acme/repo/pull/42" });
    expect(calls.find((c) => c.args[0] === "push")).toEqual({
      args: ["push", "--force-with-lease", "-u", "origin", "ric-46"],
      cwd: "/fake/wt",
    });
    expect(cliCalls).toEqual([{ cmd: "gh", args: ["pr", "create", "--fill", "--head", "ric-46"], cwd: "/fake/wt" }]);
  });
});
