import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

export interface GitPushResult {
  status: "pushed" | "up-to-date";
  branch: string;
  from: string; // short SHA of origin/<branch> before the push; "" when it did not exist
  to: string; // short SHA of origin/<branch> after the push
}

export class GitPushError extends Error {
  constructor(public readonly kind: "detached" | "rejected" | "failed", public readonly detail: string) {
    super(`git push ${kind}: ${detail}`);
    this.name = "GitPushError";
  }
}

// LC_ALL=C pins git's output to English so the markers below match a localized
// environment too (mirrors ffPull.ts). 120s covers a slow push (matches merge.ts's
// comparable fetch+rebase timeout — a push killed at the timeout misreports a push
// that may have landed, the same hazard maxBuffer guards against below).
// GIT_TERMINAL_PROMPT=0 makes a checkout with no usable credential helper fail fast
// instead of blocking on an interactive prompt until the timeout.
const defaultRun: GitRun = (args, cwd) =>
  pexec("git", args, {
    cwd,
    timeout: 120_000,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 1024 * 1024 * 64,
  });

// A server-side hook declining the push (protected branch). Checked FIRST: git prints
// the "Updates were rejected" hint alongside a hook refusal too, but pulling would not
// help here, so that hint must never be enough on its own to classify this as a
// non-fast-forward.
const REMOTE_REJECTED_MARKER = "[remote rejected]";
// Markers git prints when the push is refused because origin is ahead.
const REJECTED_MARKERS = ["[rejected]", "Updates were rejected"];

// git splits push output across stdout and stderr, so classification and detail both
// read the combination (mirrors merge.ts's outputOf).
function outputOf(e: unknown): string {
  if (e && typeof e === "object") {
    const stdout = "stdout" in e && typeof (e as { stdout?: unknown }).stdout === "string" ? (e as { stdout: string }).stdout : "";
    const stderr = "stderr" in e && typeof (e as { stderr?: unknown }).stderr === "string" ? (e as { stderr: string }).stderr : "";
    if (stdout || stderr) return `${stdout}\n${stderr}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// The remote-tracking ref, or "" when it does not exist yet (a branch never pushed).
async function remoteSha(branch: string, cwd: string, run: GitRun): Promise<string> {
  try {
    return (await run(["rev-parse", "--short", `origin/${branch}`], cwd)).stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Push the branch checked out at `cwd` to origin. Stateless: single-flight is the
 * caller's responsibility, as with ffPull. Never forces — a push that cannot
 * fast-forward is surfaced as `rejected`, not resolved.
 *
 * Pushes to `origin` explicitly (matching merge.ts's "mr" push), whereas ffPull follows
 * the branch's configured upstream — the two differ if a checkout's upstream is not
 * `origin`.
 */
export async function gitPush(cwd: string, run: GitRun = defaultRun): Promise<GitPushResult> {
  const branch = (await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).stdout.trim();
  if (!branch || branch === "HEAD") throw new GitPushError("detached", "repo is on a detached HEAD");
  const from = await remoteSha(branch, cwd, run);
  try {
    await run(["push", "origin", branch], cwd);
  } catch (e) {
    const out = outputOf(e);
    const kind = !out.includes(REMOTE_REJECTED_MARKER) && REJECTED_MARKERS.some((m) => out.includes(m))
      ? "rejected"
      : "failed";
    throw new GitPushError(kind, out.trim().slice(0, 500));
  }
  const to = await remoteSha(branch, cwd, run);
  // `git push` updates the remote-tracking ref itself, so an unchanged SHA means there
  // was nothing to push. A branch with no remote counterpart is always a real push.
  return { status: from !== "" && from === to ? "up-to-date" : "pushed", branch, from, to };
}
