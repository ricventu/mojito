import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type GitRun = (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

export interface FfPullResult {
  status: "updated" | "up-to-date";
  from: string;
  to: string;
}

export class FfPullError extends Error {
  constructor(public readonly kind: "diverged" | "failed", public readonly detail: string) {
    super(`ff-pull ${kind}: ${detail}`);
    this.name = "FfPullError";
  }
}

// LC_ALL=C pins git's output to English so the diverged markers below match a
// localized environment too. 60s covers a slow fetch.
// maxBuffer prevents ENOBUFS from misreporting a successful pull (ref already moved)
// as a failed pull when advancing many commits.
const defaultRun: GitRun = (args, cwd) =>
  pexec("git", args, { cwd, timeout: 60_000, encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, maxBuffer: 1024 * 1024 * 64 });

// Markers git prints when --ff-only cannot advance because history diverged.
const DIVERGED_MARKERS = ["Not possible to fast-forward", "Need to specify how to reconcile"];

function stderrOf(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e && typeof (e as { stderr: unknown }).stderr === "string") {
    return (e as { stderr: string }).stderr;
  }
  return e instanceof Error ? e.message : String(e);
}

// Fast-forward-pull `cwd`. Stateless: single-flight is the caller's responsibility,
// because self-update (one checkout) and per-project pull (many checkouts) scope it
// differently.
export async function ffPull(cwd: string, run: GitRun = defaultRun): Promise<FfPullResult> {
  const from = (await run(["rev-parse", "--short", "HEAD"], cwd)).stdout.trim();
  try {
    await run(["pull", "--ff-only"], cwd);
  } catch (e) {
    const stderr = stderrOf(e);
    const kind = DIVERGED_MARKERS.some((m) => stderr.includes(m)) ? "diverged" : "failed";
    throw new FfPullError(kind, stderr.trim().slice(0, 500));
  }
  const to = (await run(["rev-parse", "--short", "HEAD"], cwd)).stdout.trim();
  return { status: from === to ? "up-to-date" : "updated", from, to };
}
