import { describe, it, expect, afterEach } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mergeTicketBranch, type GitRun, type CliRun } from "@/server/merge";

const pexec = promisify(execFile);

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const run = gitAvailable() ? describe : describe.skip;

// Blocks host global/system git config (e.g. a signing key requirement or a custom
// default branch) from leaking into the fixtures, so the suite behaves the same on any
// machine. Repo-local config (set per fixture below) is unaffected by these.
const SANDBOX_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: SANDBOX_ENV }).trim();
}

// The GitRun passed to the module under test in the real-git tests below: same sandbox
// as the `git()` helper, so mergeTicketBranch's own git calls (rebase, merge, status...)
// can't pick up a host's signing config either.
const sandboxedRun: GitRun = (args, cwd) =>
  pexec("git", args, { cwd, timeout: 120_000, encoding: "utf8", env: { ...SANDBOX_ENV, LC_ALL: "C" }, maxBuffer: 1024 * 1024 * 64 });

function configureRepo(dir: string): void {
  git(dir, ["config", "user.email", "mojito-test@example.com"]);
  git(dir, ["config", "user.name", "Mojito Test"]);
  // rebase-created commits reuse the original commit's signing settings, so
  // --no-gpg-sign on the *original* commit isn't enough — pin this per repo too.
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "tag.gpgsign", "false"]);
}

// Real git fixture: a repo on `main` with one commit, plus a linked worktree
// checked out on branch `ric-46` (also one commit ahead of main's tip).
// Config is set per-repo so the suite doesn't depend on host git config. `root` is
// pushed onto `roots` before any git command runs, so a mid-fixture throw still leaves
// the temp dir tracked for cleanup.
function makeFixture(roots: string[]): { root: string; repoRoot: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "mojito-merge-"));
  roots.push(root);

  const repoRoot = join(root, "repo");
  mkdirSync(repoRoot);
  git(repoRoot, ["init", "-b", "main"]);
  configureRepo(repoRoot);
  writeFileSync(join(repoRoot, "base.txt"), "base\n");
  writeFileSync(join(repoRoot, "shared.txt"), "line1\n");
  git(repoRoot, ["add", "-A"]);
  git(repoRoot, ["commit", "--no-gpg-sign", "-m", "init"]);

  const worktree = join(root, "wt");
  git(repoRoot, ["worktree", "add", worktree, "-b", "ric-46"]);
  configureRepo(worktree);

  return { root, repoRoot, worktree };
}

// A repo cloned from a bare "upstream" remote, plus a linked worktree on branch
// `ric-46`. Used for the remote-tracking cases (behind / diverged from origin/main).
function makeRemoteFixture(roots: string[]): { root: string; bare: string; repoRoot: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "mojito-merge-remote-"));
  roots.push(root);

  const bare = join(root, "upstream.git");
  git(root, ["init", "--bare", "-b", "main", bare]);

  // Seed the bare remote with an initial commit via a throwaway clone.
  const seed = join(root, "seed");
  git(root, ["clone", bare, seed]);
  configureRepo(seed);
  writeFileSync(join(seed, "base.txt"), "base\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "--no-gpg-sign", "-m", "init"]);
  git(seed, ["push", "origin", "main"]);

  const repoRoot = join(root, "repo");
  git(root, ["clone", bare, repoRoot]);
  configureRepo(repoRoot);

  const worktree = join(root, "wt");
  git(repoRoot, ["worktree", "add", worktree, "-b", "ric-46"]);
  configureRepo(worktree);

  return { root, bare, repoRoot, worktree };
}

// Pushes a commit to the bare remote from a fresh clone, simulating another
// contributor advancing origin/main independently of `repoRoot`'s clone.
function pushFromAnotherClone(bare: string, root: string, fileName: string, content: string): void {
  const other = join(root, `other-${fileName.replace(/\W/g, "")}`);
  git(root, ["clone", bare, other]);
  configureRepo(other);
  writeFileSync(join(other, fileName), content);
  git(other, ["add", "-A"]);
  git(other, ["commit", "--no-gpg-sign", "-m", `advance: ${fileName}`]);
  git(other, ["push", "origin", "main"]);
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
    const { repoRoot, worktree } = makeFixture(roots);
    writeFileSync(join(worktree, "feature.txt"), "feature\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "add feature"]);
    const wtHead = git(worktree, ["rev-parse", "HEAD"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("merged");
    expect(git(repoRoot, ["rev-parse", "HEAD"])).toBe(wtHead);
  });

  it("rebases cleanly when main has advanced on a disjoint file", async () => {
    const { repoRoot, worktree } = makeFixture(roots);
    writeFileSync(join(worktree, "wt-file.txt"), "wt change\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "wt change"]);

    writeFileSync(join(repoRoot, "main-file.txt"), "main change\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "--no-gpg-sign", "-m", "main change"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("merged");
    // Root's tip must equal the (rebased) worktree branch tip, not just a value the
    // repo root derived on its own.
    expect(git(repoRoot, ["rev-parse", "HEAD"])).toBe(git(worktree, ["rev-parse", "HEAD"]));
    expect(existsSync(join(repoRoot, "wt-file.txt"))).toBe(true);
    expect(existsSync(join(repoRoot, "main-file.txt"))).toBe(true);
  });

  it("aborts a conflicting rebase and leaves the worktree clean", async () => {
    const { repoRoot, worktree } = makeFixture(roots);
    writeFileSync(join(worktree, "shared.txt"), "wt version\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "wt edits shared"]);

    writeFileSync(join(repoRoot, "shared.txt"), "main version\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "--no-gpg-sign", "-m", "main edits shared"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("conflict");
    expect(git(worktree, ["status", "--porcelain"])).toBe("");
    const rebaseMergePath = git(worktree, ["rev-parse", "--git-path", "rebase-merge"]);
    const rebaseApplyPath = git(worktree, ["rev-parse", "--git-path", "rebase-apply"]);
    expect(existsSync(resolve(worktree, rebaseMergePath))).toBe(false);
    expect(existsSync(resolve(worktree, rebaseApplyPath))).toBe(false);
  });

  it("errors when the repo root isn't on the default branch", async () => {
    const { repoRoot, worktree } = makeFixture(roots);
    git(worktree, ["commit", "--allow-empty", "--no-gpg-sign", "-m", "wt commit"]);
    git(repoRoot, ["checkout", "-b", "other"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.detail).toContain("other");
  });

  it("errors on a detached HEAD, without attempting a rebase", async () => {
    const { repoRoot, worktree } = makeFixture(roots);
    const beforeHead = git(worktree, ["rev-parse", "HEAD"]);
    git(worktree, ["checkout", "--detach"]);

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.detail).toContain("detached HEAD");
    expect(git(worktree, ["rev-parse", "HEAD"])).toBe(beforeHead);
  });

  it("errors when the worktree has uncommitted changes, without attempting a rebase", async () => {
    const { repoRoot, worktree } = makeFixture(roots);
    const beforeHead = git(worktree, ["rev-parse", "HEAD"]);
    writeFileSync(join(worktree, "base.txt"), "unstaged edit\n");

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") expect(outcome.detail).toContain("uncommitted changes");
    expect(git(worktree, ["rev-parse", "HEAD"])).toBe(beforeHead);
  });

  it("mode local: ff-merges cleanly when local main is behind an advanced origin/main", async () => {
    const { repoRoot, worktree, bare, root } = makeRemoteFixture(roots);
    writeFileSync(join(worktree, "feature-behind.txt"), "feature\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "feature"]);

    pushFromAnotherClone(bare, root, "upstream-advance.txt", "advance\n");

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("merged");
    expect(git(repoRoot, ["rev-parse", "HEAD"])).toBe(git(worktree, ["rev-parse", "HEAD"]));
    expect(existsSync(join(repoRoot, "upstream-advance.txt"))).toBe(true);
    expect(existsSync(join(repoRoot, "feature-behind.txt"))).toBe(true);
  });

  it("mode local: errors with a rebased-history prefix when local main diverged from origin/main", async () => {
    const { repoRoot, worktree, bare, root } = makeRemoteFixture(roots);
    writeFileSync(join(worktree, "feature-diverged.txt"), "feature\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["commit", "--no-gpg-sign", "-m", "feature"]);

    // repoRoot's local main gets a commit that is never pushed...
    writeFileSync(join(repoRoot, "local-only.txt"), "local\n");
    git(repoRoot, ["add", "-A"]);
    git(repoRoot, ["commit", "--no-gpg-sign", "-m", "local-only"]);

    // ...while origin/main advances independently from elsewhere.
    pushFromAnotherClone(bare, root, "upstream-advance.txt", "advance\n");

    const outcome = await mergeTicketBranch({ worktree, repoRoot, mode: "local" }, sandboxedRun);

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.detail.startsWith("branch already rebased onto the target; ")).toBe(true);
    }
  });
});

describe("mergeTicketBranch (mr mode, faked run/runCli)", () => {
  it("pushes with force-with-lease then creates a PR, scraping the URL from fake stdout", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const fakeRun: GitRun = async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return { stdout: "ric-46\n", stderr: "" };
      if (args[0] === "status") return { stdout: "", stderr: "" };
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

    const firstArgs = calls.map((c) => c.args[0]);
    expect(firstArgs.indexOf("rebase")).toBeGreaterThanOrEqual(0);
    expect(firstArgs.indexOf("push")).toBeGreaterThanOrEqual(0);
    expect(firstArgs.indexOf("rebase")).toBeLessThan(firstArgs.indexOf("push"));
  });
});
