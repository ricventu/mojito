import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
export type CliRun = (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string }>;

// LC_ALL=C pins git output to English (mirrors ffPull.ts); 120s covers a slow fetch+rebase.
const defaultRun: GitRun = (args, cwd) =>
  pexec("git", args, { cwd, timeout: 120_000, encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 * 64 });
const defaultCli: CliRun = (cmd, args, cwd) => pexec(cmd, args, { cwd, timeout: 60_000, encoding: "utf8" });

export type MergeMode = "local" | "mr";
export type MergeOutcome =
  | { status: "merged"; commit: string }
  | { status: "mr-created"; url: string }
  | { status: "conflict"; detail: string }
  | { status: "error"; detail: string };

function detailOf(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && typeof (e as { stderr: unknown }).stderr === "string") {
    return (e as { stderr: string }).stderr.trim().slice(0, 500);
  }
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

export async function detectDefaultBranch(repo: string, run: GitRun = defaultRun): Promise<string> {
  try {
    const { stdout } = await run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo);
    const name = stdout.trim().replace(/^origin\//, "");
    if (name) return name;
  } catch {
    /* no origin/HEAD ref — fall through to local candidates */
  }
  for (const name of ["main", "master"]) {
    try {
      await run(["rev-parse", "--verify", `refs/heads/${name}`], repo);
      return name;
    } catch {
      /* try next */
    }
  }
  throw new Error("cannot determine default branch");
}

/**
 * The QA-approve merge: rebase the worktree branch onto the (possibly remote) default
 * branch, then either fast-forward the repo root ("local") or push + open an MR ("mr").
 * A conflicted rebase is aborted so the worktree is always left clean for the
 * conflict-resolution session that follows.
 */
export async function mergeTicketBranch(
  input: { worktree: string; repoRoot: string; mode: MergeMode },
  run: GitRun = defaultRun,
  runCli: CliRun = defaultCli,
): Promise<MergeOutcome> {
  const { worktree, repoRoot, mode } = input;
  try {
    const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], worktree)).stdout.trim();
    const hasRemote = (await run(["remote"], worktree)).stdout.trim().length > 0;
    if (hasRemote) await run(["fetch", "--prune"], worktree);
    const def = await detectDefaultBranch(repoRoot, run);
    const target = hasRemote ? `origin/${def}` : def;

    try {
      await run(["rebase", target], worktree);
    } catch (e) {
      try {
        await run(["rebase", "--abort"], worktree);
      } catch {
        /* nothing to abort */
      }
      return { status: "conflict", detail: detailOf(e) };
    }

    if (mode === "mr") {
      await run(["push", "--force-with-lease", "-u", "origin", branch], worktree);
      const origin = (await run(["remote", "get-url", "origin"], worktree)).stdout;
      const [cmd, ...args] = origin.includes("gitlab")
        ? ["glab", "mr", "create", "--fill", "--yes"]
        : ["gh", "pr", "create", "--fill", "--head", branch];
      const { stdout } = await runCli(cmd, args, worktree);
      return { status: "mr-created", url: (stdout.match(/https?:\/\/\S+/) ?? [""])[0] };
    }

    // local: the repo root's checkout receives the merge, so it must be on the default branch.
    const rootBranch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot)).stdout.trim();
    if (rootBranch !== def) return { status: "error", detail: `repo root is on ${rootBranch}, not ${def}` };
    await run(["merge", "--ff-only", branch], repoRoot);
    const commit = (await run(["rev-parse", "--short", "HEAD"], repoRoot)).stdout.trim();
    return { status: "merged", commit };
  } catch (e) {
    return { status: "error", detail: detailOf(e) };
  }
}
