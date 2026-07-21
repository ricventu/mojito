import { execFileSync } from "node:child_process";
import type { Effort } from "./types.js";

// A branch review below these thresholds does not need the top model at top effort
// (mirrors superpowers SDD's own "scale review model to the diff" guidance).
export const SMALL_DIFF_LINES = 150;
export const MEDIUM_DIFF_LINES = 400;

const MODEL_RANK: Record<string, number> = { sonnet: 0, opus: 1, fable: 2 };
const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

type Run = (cmd: string, args: string[]) => string;

export function parseShortstat(s: string): number {
  const ins = /(\d+) insertions?\(\+\)/.exec(s);
  const del = /(\d+) deletions?\(-\)/.exec(s);
  return (ins ? Number(ins[1]) : 0) + (del ? Number(del[1]) : 0);
}

export function detectDefaultBranch(run: Run): string | null {
  try {
    const ref = run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim();
    const name = ref.split("/").slice(1).join("/");
    if (name) return name;
  } catch { /* no origin/HEAD — try local names */ }
  for (const name of ["main", "master"]) {
    try {
      run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
      return name;
    } catch { /* not this one */ }
  }
  return null;
}

// Changed lines (insertions + deletions) of the branch vs the default branch's
// merge-base. null = could not measure (no default branch, git error) — callers
// must fail open and keep the unscaled profile.
export function branchChangedLines(
  cwd: string,
  run: Run = (cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8" }),
): number | null {
  const base = detectDefaultBranch(run);
  if (!base) return null;
  try {
    return parseShortstat(run("git", ["diff", "--shortstat", `${base}...HEAD`]));
  } catch {
    return null;
  }
}

// Downgrade-only: the result is the per-axis minimum of the requested profile and the
// diff-size target, so an already-cheap request is never raised.
export function scaleReviewProfile(
  model: string,
  effort: Effort,
  changedLines: number,
): { model: string; effort: Effort; scaled: boolean } {
  let target: { model: string; effort: Effort } | null = null;
  if (changedLines < SMALL_DIFF_LINES) target = { model: "sonnet", effort: "medium" };
  else if (changedLines < MEDIUM_DIFF_LINES) target = { model, effort: "high" };
  if (!target) return { model, effort, scaled: false };
  const outModel =
    (MODEL_RANK[target.model] ?? Infinity) < (MODEL_RANK[model] ?? Infinity) ? target.model : model;
  const outEffort =
    (EFFORT_RANK[target.effort] ?? Infinity) < (EFFORT_RANK[effort] ?? Infinity) ? target.effort : effort;
  return { model: outModel, effort: outEffort, scaled: outModel !== model || outEffort !== effort };
}
