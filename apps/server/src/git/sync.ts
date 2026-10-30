import { GitError, type GitRun } from "./git";

/**
 * A pull or push that Mojito did not finish and hands to a Claude session. The repo is left as
 * it was: a conflicting rebase is aborted, uncommitted changes are never stashed or touched —
 * ticket sessions work in this same checkout, and what is uncommitted may be theirs.
 */
export interface SyncConflict {
  status: "conflict";
  branch: string;
  upstream: string;
  reason: string;
}

export type PullOutcome =
  | { status: "updated"; branch: string; from: string; to: string; commits: number }
  | { status: "up-to-date"; branch: string }
  | SyncConflict;

export type PushOutcome =
  | { status: "pushed"; branch: string; commits: number; pulled: number }
  | { status: "up-to-date"; branch: string }
  | SyncConflict;

/** A pull or push that failed outright (no branch, no upstream, the network): nothing for Claude to resolve. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

const outputOf = (err: unknown) => (err instanceof GitError ? err.output : String(err)).trim();

/** git's own message, as a `SyncError`: what the human reads in the toast. */
const failed = (err: unknown): SyncError => new SyncError(outputOf(err).slice(0, 500) || "git failed");

async function attempt(run: GitRun, args: string[], cwd: string): Promise<string | null> {
  try {
    return (await run(args, cwd)).trim();
  } catch {
    return null;
  }
}

async function currentBranch(run: GitRun, cwd: string): Promise<string> {
  const branch = await attempt(run, ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  if (!branch) throw new SyncError("HEAD is detached: check out a branch first");
  return branch;
}

const upstreamOf = (run: GitRun, cwd: string) => attempt(run, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);

const shortHead = async (run: GitRun, cwd: string) => (await run(["rev-parse", "--short", "HEAD"], cwd)).trim();

/**
 * Brings the checked-out branch up to date with its upstream. Only behind: a fast-forward,
 * which git allows over uncommitted changes it does not touch. Diverged: the local commits are
 * rebased onto the upstream, but only on a clean tree. Anything that would need a decision —
 * a rebase conflict, uncommitted changes in the way — is a `conflict`, with the repo untouched.
 */
export async function pull(cwd: string, run: GitRun): Promise<PullOutcome> {
  const branch = await currentBranch(run, cwd);
  const upstream = await upstreamOf(run, cwd);
  if (!upstream) throw new SyncError(`${branch} has no upstream: push it first`);
  try {
    await run(["fetch", "--quiet"], cwd);
  } catch (err) {
    throw failed(err);
  }
  const [ahead, behind] = (await run(["rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd)).trim().split(/\s+/).map(Number);
  if (behind === 0) return { status: "up-to-date", branch };
  const from = await shortHead(run, cwd);
  const conflict = (reason: string): SyncConflict => ({ status: "conflict", branch, upstream, reason });

  if (ahead === 0) {
    try {
      await run(["merge", "--ff-only", "--quiet", "@{u}"], cwd);
    } catch (err) {
      const output = outputOf(err);
      if (output.includes("would be overwritten")) return conflict(`Fast-forwarding to ${upstream} would overwrite uncommitted changes:\n${output}`);
      throw failed(err);
    }
    return { status: "updated", branch, from, to: await shortHead(run, cwd), commits: behind };
  }

  const diverged = `${branch} and ${upstream} have diverged (${ahead} local, ${behind} remote commits)`;
  const dirty = await run(["status", "--porcelain", "--untracked-files=no"], cwd);
  if (dirty.trim()) return conflict(`${diverged}, and the working tree has uncommitted changes:\n${dirty.trimEnd()}`);
  try {
    await run(["rebase", "--quiet", "@{u}"], cwd);
  } catch (err) {
    const files = (await attempt(run, ["diff", "--name-only", "--diff-filter=U"], cwd)) ?? "";
    const aborted = (await attempt(run, ["rebase", "--abort"], cwd)) !== null;
    if (!aborted) throw new SyncError(`rebase failed and could not be aborted: ${outputOf(err).slice(0, 400)}`);
    if (files) return conflict(`${diverged}; rebasing the local commits onto ${upstream} conflicts in:\n${files}`);
    throw failed(err);
  }
  return { status: "updated", branch, from, to: await shortHead(run, cwd), commits: behind };
}

// git prints "Updates were rejected" beside a server hook's refusal too, where pulling would not
// help: "[remote rejected]" rules the hint out.
const isBehindRemote = (output: string) =>
  !output.includes("[remote rejected]") && (output.includes("[rejected]") || output.includes("Updates were rejected"));

/** Commits on HEAD that no remote-tracking branch has. */
const unpushed = async (run: GitRun, cwd: string) => Number((await run(["rev-list", "--count", "HEAD", "--not", "--remotes"], cwd)).trim());

/**
 * Pushes the checked-out branch to its upstream, or publishes it to origin (and tracks it) when
 * it has none. Never forces: a push the remote rejects for being behind runs `pull` and tries
 * once more, so a `conflict` from that pull means nothing was pushed.
 */
export async function push(cwd: string, run: GitRun): Promise<PushOutcome> {
  const branch = await currentBranch(run, cwd);
  const upstream = await upstreamOf(run, cwd);
  let args: string[];
  if (upstream) {
    const remote = (await run(["config", `branch.${branch}.remote`], cwd)).trim();
    const merge = (await run(["config", `branch.${branch}.merge`], cwd)).trim();
    args = ["push", "--quiet", remote, `HEAD:${merge}`];
  } else {
    args = ["push", "--quiet", "-u", "origin", "HEAD"];
  }

  // A branch never published is pushed even with nothing of its own: publishing it is the point.
  if (upstream && (await unpushed(run, cwd)) === 0) return { status: "up-to-date", branch };
  let pulled = 0;
  for (;;) {
    const commits = await unpushed(run, cwd);
    try {
      await run(args, cwd);
      return { status: "pushed", branch, commits, pulled };
    } catch (err) {
      if (pulled > 0 || !upstream || !isBehindRemote(outputOf(err))) throw failed(err);
    }
    const r = await pull(cwd, run);
    if (r.status === "conflict") return r;
    if (r.status === "up-to-date") throw new SyncError(`push to ${upstream} rejected, and there was nothing to pull`);
    pulled = r.commits;
  }
}
