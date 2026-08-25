import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseWorktrees, matchWorktree, worktreeSlug, listLocalBranches, listRemoteBranches,
  findExistingTicketWorktree, createTicketWorktree, listPickableWorktrees, resolveWorktreePick,
  splitRemoteRef, fetchAllRemotes,
} from "@/server/worktree";

const PORCELAIN = `worktree /code/lime
HEAD abc
branch refs/heads/main

worktree /code/lime-RIC-46
HEAD def
branch refs/heads/ric-46-add-thing
`;

describe("worktree parsing", () => {
  it("parses porcelain output", () => {
    const wts = parseWorktrees(PORCELAIN);
    expect(wts).toHaveLength(2);
    expect(wts[1]).toEqual({ path: "/code/lime-RIC-46", branch: "ric-46-add-thing" });
  });
  it("matches a worktree by ticket id (case-insensitive)", () => {
    const wts = parseWorktrees(PORCELAIN);
    expect(matchWorktree(wts, "RIC-46")).toBe("/code/lime-RIC-46");
    expect(matchWorktree(wts, "RIC-99")).toBeNull();
  });
});

describe("worktreeSlug", () => {
  it("combines the ticket id with a kebab-cased title", () => {
    expect(worktreeSlug("RIC-184", "Worktree per ticket launch")).toBe("RIC-184-worktree-per-ticket-launch");
  });
  it("falls back to the bare ticket id when the title has no sluggable characters", () => {
    expect(worktreeSlug("RIC-184", "")).toBe("RIC-184");
    expect(worktreeSlug("RIC-184", "!!!")).toBe("RIC-184");
  });
  it("truncates a long title so the branch/dir name stays reasonable", () => {
    const title = "a".repeat(80);
    const slug = worktreeSlug("RIC-184", title);
    expect(slug.length).toBeLessThanOrEqual("RIC-184-".length + 40);
    expect(slug.startsWith("RIC-184-")).toBe(true);
  });
});

function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const run = gitAvailable() ? describe : describe.skip;

const SANDBOX_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: SANDBOX_ENV }).trim();
}

function configureRepo(dir: string): void {
  git(dir, ["config", "user.email", "mojito-test@example.com"]);
  git(dir, ["config", "user.name", "Mojito Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
}

// A repo on `main` with one commit, no linked worktree yet.
function makeRepo(roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "mojito-wt-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  configureRepo(repo);
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "--no-gpg-sign", "-m", "init"]);
  // git reports worktree paths with symlinks resolved (e.g. macOS /var -> /private/var);
  // realpath here so string comparisons against git's own output line up.
  return realpathSync(repo);
}

// A clone of a fresh repo: the pair every remote-base case needs — `upstream` is the server,
// `clone` is the checkout a launch happens in, with origin/main pointing at whatever it last
// fetched.
function makeClone(roots: string[]): { upstream: string; clone: string } {
  const upstream = makeRepo(roots);
  const clone = join(upstream, "..", "clone");
  execFileSync("git", ["clone", upstream, clone], { encoding: "utf8", env: SANDBOX_ENV });
  configureRepo(clone);
  return { upstream, clone: realpathSync(clone) };
}

// A commit on the upstream's main that the clone has not seen yet.
function commitUpstream(upstream: string, file: string): void {
  writeFileSync(join(upstream, file), "later\n");
  git(upstream, ["add", "-A"]);
  git(upstream, ["commit", "--no-gpg-sign", "-m", `add ${file}`]);
}

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

run("listLocalBranches", () => {
  it("lists the repo's local branches", () => {
    const repo = makeRepo(roots);
    git(repo, ["branch", "other"]);
    expect(listLocalBranches(repo).sort()).toEqual(["main", "other"]);
  });
  it("returns an empty list when git fails (not a repo)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mojito-wt-notrepo-"));
    roots.push(dir);
    expect(listLocalBranches(dir)).toEqual([]);
  });
});

run("findExistingTicketWorktree", () => {
  it("finds the slugged fixed-path worktree when it is registered", () => {
    const repo = makeRepo(roots);
    const fixed = join(repo, ".claude", "worktrees", "RIC-46-add-thing");
    git(repo, ["worktree", "add", fixed, "-b", "RIC-46-add-thing"]);
    expect(findExistingTicketWorktree(repo, "RIC-46", "Add thing")).toBe(fixed);
  });
  it("falls back to a worktree matched by branch name elsewhere (legacy)", () => {
    const repo = makeRepo(roots);
    const legacy = join(repo, "..", "legacy-wt");
    git(repo, ["worktree", "add", legacy, "-b", "ric-46-legacy-branch"]);
    expect(findExistingTicketWorktree(repo, "RIC-46", "Add thing")).toBe(legacy);
  });
  it("returns null when no worktree exists for the ticket", () => {
    const repo = makeRepo(roots);
    expect(findExistingTicketWorktree(repo, "RIC-46", "Add thing")).toBeNull();
  });
});

run("createTicketWorktree", () => {
  it("creates the worktree at the slugged fixed path, off the given base branch", async () => {
    const repo = makeRepo(roots);
    const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "main");
    expect(res.cwd).toBe(join(repo, ".claude", "worktrees", "RIC-46-add-thing"));
    expect(existsSync(res.cwd)).toBe(true);
    expect(res.warning).toContain("init-worktree.sh");
  });

  it("runs scripts/init-worktree.sh in the new worktree when present, no warning", async () => {
    const repo = makeRepo(roots);
    const scriptsDir = join(repo, "scripts");
    mkdirSync(scriptsDir);
    const script = join(scriptsDir, "init-worktree.sh");
    writeFileSync(script, "#!/bin/sh\npwd > marker.txt\n");
    chmodSync(script, 0o755);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "add setup script"]);

    const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "main");
    expect(res.warning).toBeUndefined();
    const marker = readFileSync(join(res.cwd, "marker.txt"), "utf8").trim();
    expect(marker).toBe(res.cwd);
  });

  // RIC-207: Mojito runs this script itself, so it used to hand it Mojito's own
  // NODE_ENV=production — under which the `pnpm install` a setup script typically does
  // strips the fresh worktree's devDependencies and still exits 0.
  it("runs the setup script without Mojito's own environment", async () => {
    const repo = makeRepo(roots);
    const scriptsDir = join(repo, "scripts");
    mkdirSync(scriptsDir);
    const script = join(scriptsDir, "init-worktree.sh");
    writeFileSync(script, '#!/bin/sh\necho "node_env=[$NODE_ENV] leaked=[$LINEAR_API_KEY]" > env.txt\n');
    chmodSync(script, 0o755);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "add env-dumping setup script"]);

    process.env.LINEAR_API_KEY = "lin_api_should_not_leak";
    try {
      const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "main");
      expect(readFileSync(join(res.cwd, "env.txt"), "utf8").trim()).toBe("node_env=[] leaked=[]");
    } finally {
      delete process.env.LINEAR_API_KEY;
    }
  });

  it("surfaces a warning (not a throw) when the setup script fails, keeping the worktree", async () => {
    const repo = makeRepo(roots);
    const scriptsDir = join(repo, "scripts");
    mkdirSync(scriptsDir);
    const script = join(scriptsDir, "init-worktree.sh");
    writeFileSync(script, "#!/bin/sh\nexit 1\n");
    chmodSync(script, 0o755);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "add failing setup script"]);

    const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "main");
    expect(existsSync(res.cwd)).toBe(true);
    expect(res.warning).toContain("init-worktree.sh");
  });

  // The actual failure reason (composer/pnpm's error block) tends to print near the END of
  // a script's output, after a long run of progress noise — a head-truncated warning shows
  // only the noise and hides the reason, as happened for real on RIC-203.
  it("keeps the meaningful tail of a long failure, not just the noisy head", async () => {
    const repo = makeRepo(roots);
    const scriptsDir = join(repo, "scripts");
    mkdirSync(scriptsDir);
    const script = join(scriptsDir, "init-worktree.sh");
    const noise = "X".repeat(400); // well past any reasonable truncation budget
    writeFileSync(script, `#!/bin/sh\nprintf '${noise}' >&2\necho "" >&2\necho "REAL ERROR: dependency conflict" >&2\nexit 1\n`);
    chmodSync(script, 0o755);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "add script with noisy-then-specific stderr"]);

    const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "main");
    expect(res.warning).toContain("REAL ERROR: dependency conflict");
  });

  it("falls back to the repo with a warning when git worktree add itself fails", async () => {
    const repo = makeRepo(roots);
    const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "no-such-branch");
    expect(res.cwd).toBe(repo);
    expect(res.warning).toBeTruthy();
  });

  // The actual bug this was written to catch (RIC-203): a slow setup script running via
  // execFileSync blocks Node's single-threaded event loop for its whole duration — freezing
  // the entire server, including /api/health, which trips prod-supervisor.mjs's watchdog
  // into killing and restarting mid-request. A timer scheduled just before the call MUST
  // fire before the (slower) script-backed call resolves, proving the event loop kept
  // running concurrently with the script instead of being blocked by it.
  it("does not block the event loop while the setup script runs", async () => {
    const repo = makeRepo(roots);
    const scriptsDir = join(repo, "scripts");
    mkdirSync(scriptsDir);
    const script = join(scriptsDir, "init-worktree.sh");
    writeFileSync(script, "#!/bin/sh\nsleep 0.3\n");
    chmodSync(script, 0o755);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "add slow setup script"]);

    let tickedDuringCall = false;
    const timer = setTimeout(() => { tickedDuringCall = true; }, 50);
    await createTicketWorktree(repo, "RIC-46", "Add thing", "main");
    clearTimeout(timer);
    expect(tickedDuringCall).toBe(true);
  });

  it("kills a hung script past its timeout and returns a warning instead of hanging forever", async () => {
    const repo = makeRepo(roots);
    const scriptsDir = join(repo, "scripts");
    mkdirSync(scriptsDir);
    const script = join(scriptsDir, "init-worktree.sh");
    writeFileSync(script, "#!/bin/sh\nsleep 5\n");
    chmodSync(script, 0o755);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "--no-gpg-sign", "-m", "add hanging setup script"]);

    const res = await createTicketWorktree(repo, "RIC-46", "Add thing", "main", undefined, 200);
    expect(res.warning).toContain("init-worktree.sh");
  });
});

const PORCELAIN_FLAGGED = `worktree /code/lime
HEAD abc
bare

worktree /code/lime-detached
HEAD def
detached

worktree /code/lime-gone
HEAD ghi
branch refs/heads/gone
prunable gitdir file points to non-existent location
`;

describe("parseWorktrees flags", () => {
  it("leaves a plain worktree free of flags, so the shape stays {path, branch}", () => {
    expect(parseWorktrees(PORCELAIN)[0]).toEqual({ path: "/code/lime", branch: "main" });
  });
  it("records bare, detached and prunable", () => {
    const wts = parseWorktrees(PORCELAIN_FLAGGED);
    expect(wts[0]).toEqual({ path: "/code/lime", branch: "", bare: true });
    expect(wts[1]).toEqual({ path: "/code/lime-detached", branch: "", detached: true });
    expect(wts[2]).toEqual({
      path: "/code/lime-gone", branch: "gone", prunable: true,
    });
  });
});

run("listPickableWorktrees", () => {
  it("lists the repo's linked worktrees, never the repo itself", () => {
    const repo = makeRepo(roots);
    const a = join(repo, ".claude", "worktrees", "RIC-1-a");
    git(repo, ["worktree", "add", a, "-b", "RIC-1-a"]);
    expect(listPickableWorktrees(repo)).toEqual([{ path: a, branch: "RIC-1-a" }]);
  });
  it("returns an empty list when the repo has no linked worktree", () => {
    expect(listPickableWorktrees(makeRepo(roots))).toEqual([]);
  });
  it("drops a worktree whose directory is gone — launching there would fail", () => {
    const repo = makeRepo(roots);
    const gone = join(repo, ".claude", "worktrees", "RIC-2-gone");
    git(repo, ["worktree", "add", gone, "-b", "RIC-2-gone"]);
    rmSync(gone, { recursive: true, force: true });
    expect(listPickableWorktrees(repo)).toEqual([]);
  });
  it("returns an empty list when git fails (not a repo)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mojito-wt-notrepo-"));
    roots.push(dir);
    expect(listPickableWorktrees(dir)).toEqual([]);
  });
});

run("resolveWorktreePick", () => {
  it("accepts a path the repo actually has a worktree at", () => {
    const repo = makeRepo(roots);
    const a = join(repo, ".claude", "worktrees", "RIC-1-a");
    git(repo, ["worktree", "add", a, "-b", "RIC-1-a"]);
    expect(resolveWorktreePick(repo, a)).toBe(a);
  });
  // The client names the directory a session is spawned in, so an unlisted path is the
  // one thing that must never be honoured — including the repo root's own parent tricks.
  it("refuses a path that is not one of the repo's worktrees", () => {
    const repo = makeRepo(roots);
    expect(resolveWorktreePick(repo, join(repo, "..", "elsewhere"))).toBeNull();
    expect(resolveWorktreePick(repo, "/etc")).toBeNull();
  });
  it("refuses the repo root itself — that is the no-pick fallback, not a pick", () => {
    const repo = makeRepo(roots);
    expect(resolveWorktreePick(repo, repo)).toBeNull();
  });
  it("refuses a worktree whose directory has been removed since the list was fetched", () => {
    const repo = makeRepo(roots);
    const gone = join(repo, ".claude", "worktrees", "RIC-2-gone");
    git(repo, ["worktree", "add", gone, "-b", "RIC-2-gone"]);
    rmSync(gone, { recursive: true, force: true });
    expect(resolveWorktreePick(repo, gone)).toBeNull();
  });
});

describe("splitRemoteRef", () => {
  const remotes = ["origin", "upstream"];
  it("splits a remote-tracking name into its remote and branch", () => {
    expect(splitRemoteRef("origin/main", remotes)).toEqual({ remote: "origin", branch: "main" });
    expect(splitRemoteRef("upstream/release/2.x", remotes)).toEqual({ remote: "upstream", branch: "release/2.x" });
  });
  // `feature/foo` is an ordinary local branch name: only the remote list can tell the two apart.
  it("answers null for a local branch, however many slashes it has", () => {
    expect(splitRemoteRef("main", remotes)).toBeNull();
    expect(splitRemoteRef("feature/foo", remotes)).toBeNull();
  });
  it("prefers the longest matching remote name", () => {
    expect(splitRemoteRef("origin/mirror/main", ["origin", "origin/mirror"]))
      .toEqual({ remote: "origin/mirror", branch: "main" });
  });
  it("answers null when the repo has no remotes at all", () => {
    expect(splitRemoteRef("origin/main", [])).toBeNull();
  });
});

run("listRemoteBranches", () => {
  it("lists the repo's remote-tracking branches, never origin/HEAD", () => {
    const { clone } = makeClone(roots);
    // git clone writes origin/HEAD as a symref onto origin/main: kept, it would offer the
    // same branch twice under a name that hides which one it is.
    expect(listRemoteBranches(clone)).toEqual(["origin/main"]);
  });
  it("returns an empty list for a repo with no remote", () => {
    expect(listRemoteBranches(makeRepo(roots))).toEqual([]);
  });
  it("returns an empty list when git fails (not a repo)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mojito-wt-notrepo-"));
    roots.push(dir);
    expect(listRemoteBranches(dir)).toEqual([]);
  });
});

run("fetchAllRemotes", () => {
  it("brings the remote-tracking refs up to date", async () => {
    const { upstream, clone } = makeClone(roots);
    commitUpstream(upstream, "later.txt");
    const before = git(clone, ["rev-parse", "origin/main"]);
    await fetchAllRemotes(clone);
    expect(git(clone, ["rev-parse", "origin/main"])).not.toBe(before);
    expect(git(clone, ["rev-parse", "origin/main"])).toBe(git(upstream, ["rev-parse", "main"]));
  });
  it("throws when the fetch fails, so the action can report it", async () => {
    const { upstream, clone } = makeClone(roots);
    rmSync(upstream, { recursive: true, force: true });
    await expect(fetchAllRemotes(clone)).rejects.toThrow();
  });
});

run("createTicketWorktree off a remote base", () => {
  // The point of offering origin/main at all: the ref is only as fresh as the last fetch, so
  // a remote base is fetched before the worktree is cut from it.
  it("fetches the picked remote branch first, so the worktree carries the newest commit", async () => {
    const { upstream, clone } = makeClone(roots);
    commitUpstream(upstream, "later.txt");
    const res = await createTicketWorktree(clone, "RIC-9", "Off origin", "origin/main");
    expect(existsSync(join(res.cwd, "later.txt"))).toBe(true);
    // The local main is left where it was — the fetch updates tracking refs, nothing else.
    expect(existsSync(join(clone, "later.txt"))).toBe(false);
  });

  it("does not fetch for a local base", async () => {
    const { upstream, clone } = makeClone(roots);
    commitUpstream(upstream, "later.txt");
    const res = await createTicketWorktree(clone, "RIC-9", "Off local", "main");
    expect(existsSync(join(res.cwd, "later.txt"))).toBe(false);
    expect(git(clone, ["rev-parse", "origin/main"])).not.toBe(git(upstream, ["rev-parse", "main"]));
  });

  // Offline, expired credentials, a moved remote: the base is then whatever git already had,
  // which is still work the user can do — the launch is warned about, never blocked.
  it("still creates the worktree when the fetch fails, with a warning", async () => {
    const { upstream, clone } = makeClone(roots);
    rmSync(upstream, { recursive: true, force: true });
    const res = await createTicketWorktree(clone, "RIC-9", "Off origin", "origin/main");
    expect(res.cwd).toBe(join(clone, ".claude", "worktrees", "RIC-9-off-origin"));
    expect(existsSync(res.cwd)).toBe(true);
    expect(res.warning).toContain("could not fetch origin/main");
  });

  // Two independent failures, one warning field: the fetch one used to be the only thing
  // reported, or got dropped by whichever return happened last.
  it("reports the fetch warning alongside the setup-script one", async () => {
    const { upstream, clone } = makeClone(roots);
    rmSync(upstream, { recursive: true, force: true });
    const res = await createTicketWorktree(clone, "RIC-9", "Off origin", "origin/main");
    expect(res.warning).toContain("could not fetch origin/main");
    expect(res.warning).toContain("init-worktree.sh");
  });
});
