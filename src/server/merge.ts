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

// Combined stdout+stderr of a failed exec, used only for marker classification (not
// truncated like detailOf, since markers can appear anywhere in git's output).
function outputOf(e: unknown): string {
  if (e && typeof e === "object") {
    const stdout = "stdout" in e && typeof (e as { stdout?: unknown }).stdout === "string" ? (e as { stdout: string }).stdout : "";
    const stderr = "stderr" in e && typeof (e as { stderr?: unknown }).stderr === "string" ? (e as { stderr: string }).stderr : "";
    return `${stdout}\n${stderr}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// Markers git prints on a genuine rebase conflict, as opposed to a refusal that never
// started applying patches (missing ref, etc). Mirrors ffPull.ts's DIVERGED_MARKERS
// approach: classify by output text rather than assuming every failure is the same kind.
const CONFLICT_MARKERS = ["CONFLICT", "could not apply"];

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
 *
 * Two guards run before any rebase is attempted, so history is never touched on a
 * refusal: a detached HEAD in the worktree, and an uncommitted-changes tree (non-empty
 * `status --porcelain`) both report {status:"error"} without rebasing. A rebase failure
 * is then classified by its output: genuine conflict markers ("CONFLICT", "could not
 * apply") report {status:"conflict"}; anything else (e.g. a missing ref) reports
 * {status:"error"}. Either way the rebase is aborted so the worktree is always left
 * clean for whatever follows — a conflict-resolution session, or a retry.
 */
export async function mergeTicketBranch(
  input: { worktree: string; repoRoot: string; mode: MergeMode },
  run: GitRun = defaultRun,
  runCli: CliRun = defaultCli,
): Promise<MergeOutcome> {
  const { worktree, repoRoot, mode } = input;
  try {
    const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], worktree)).stdout.trim();
    if (!branch || branch === "HEAD") {
      return { status: "error", detail: "worktree is on a detached HEAD" };
    }

    const dirty = (await run(["status", "--porcelain"], worktree)).stdout.trim();
    if (dirty) {
      return { status: "error", detail: "worktree has uncommitted changes" };
    }

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
      const isConflict = CONFLICT_MARKERS.some((m) => outputOf(e).includes(m));
      return isConflict ? { status: "conflict", detail: detailOf(e) } : { status: "error", detail: detailOf(e) };
    }

    if (mode === "mr") {
      await run(["push", "--force-with-lease", "-u", "origin", branch], worktree);
      const origin = (await run(["remote", "get-url", "origin"], worktree)).stdout;
      const [cmd, ...args] = origin.includes("gitlab")
        ? ["glab", "mr", "create", "--fill", "--yes"]
        : ["gh", "pr", "create", "--fill", "--head", branch];
      const { stdout } = await runCli(cmd, args, worktree);
      const url = stdout.match(/https?:\/\/\S+/);
      return { status: "mr-created", url: url ? url[0] : stdout.trim().slice(0, 200) };
    }

    // local: the repo root's checkout receives the merge, so it must be on the default branch.
    const rootBranch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot)).stdout.trim();
    if (rootBranch !== def) return { status: "error", detail: `repo root is on ${rootBranch}, not ${def}` };
    try {
      await run(["merge", "--ff-only", branch], repoRoot);
    } catch (e) {
      // The ticket branch has already been rebased onto the target by this point, so
      // the caller needs to know history moved even though the local merge failed.
      return { status: "error", detail: `branch already rebased onto the target; ${detailOf(e)}` };
    }
    const commit = (await run(["rev-parse", "--short", "HEAD"], repoRoot)).stdout.trim();
    return { status: "merged", commit };
  } catch (e) {
    return { status: "error", detail: detailOf(e) };
  }
}
