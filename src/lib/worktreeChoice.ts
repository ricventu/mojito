import type { WorktreeChoice } from "./worktreeOptions";

/**
 * What GET /api/tickets/[id]/worktree-status answers (see getTicketWorktreeStatus).
 * Declared here rather than imported from the server module so the sheet's own model
 * stays testable in the node-only vitest setup, with no route to the git calls behind it.
 */
export interface WorktreeStatus {
  exists: boolean;
  branches: string[];
  remoteBranches: string[];
  defaultBranch: string | null;
  worktrees: WorktreeChoice[];
}

/** The three answers, in the order the sheet offers them. */
export type WorktreeAnswerKind = "no" | "pick" | "create";

/**
 * The launch sheet's answer to "create a worktree for this ticket?".
 *
 * `kind` is the discriminator the sheet renders on, and the two values below are what
 * that kind's own select edits. It is deliberately not derived from those values: a user
 * who chose "use existing" and then reset the select to the repo root is still in the
 * picker — deriving the mode from a non-empty `worktree` would make the select vanish
 * under them with no way back.
 */
export interface WorktreeAnswer {
  kind: WorktreeAnswerKind;
  /** The base a created worktree branches off. Empty unless kind is "create". */
  baseBranch: string;
  /** A worktree the repo already has, opened instead of creating one. Empty = repo root. */
  worktree: string;
}

/**
 * The bases a created worktree can branch off, remote-tracking ones first.
 *
 * Remotes lead because they are the answer that is almost always wanted: the local `main`
 * of a checkout Mojito's own sessions work in is routinely behind the server, and a worktree
 * branched off it starts with someone else's merged work missing. Nothing is deduplicated —
 * `main` and `origin/main` are genuinely different commits, which is the entire point.
 */
export function baseBranchOptions(status: WorktreeStatus): string[] {
  return [...status.remoteBranches, ...status.branches];
}

/**
 * The base the select opens on: the *remote* default branch when the repo has one
 * (`origin/main`), the local default otherwise, and failing that whatever the list starts
 * with — an empty string only when there is nothing at all to offer.
 *
 * The remote's name for the default branch comes from the local one (detectDefaultBranch
 * answers a bare `main`), matched by tail against the remote list rather than by assuming
 * `origin`: a repo whose only remote is `upstream` still gets a remote default.
 */
export function defaultBaseBranch(status: WorktreeStatus): string {
  const def = status.defaultBranch;
  if (def) {
    const remote = status.remoteBranches.find((b) => b === `origin/${def}`)
      ?? status.remoteBranches.find((b) => b.endsWith(`/${def}`));
    if (remote) return remote;
    if (status.branches.includes(def)) return def;
  }
  return baseBranchOptions(status)[0] ?? "";
}

/**
 * The answer to keep after a Fetch refreshed the status: the same one, unless the base it
 * names is no longer on offer (the fetch pruned a remote-tracking ref whose branch was
 * deleted on the server), in which case it falls back to the default.
 *
 * A value with no matching option is not a harmless leftover — the select renders blank and
 * submits the branch nobody chose (the same trap knownProject exists for).
 */
export function reconcileBaseBranch(answer: WorktreeAnswer | null, status: WorktreeStatus): WorktreeAnswer | null {
  if (answer?.kind !== "create") return answer;
  if (baseBranchOptions(status).includes(answer.baseBranch)) return answer;
  return { ...answer, baseBranch: defaultBaseBranch(status) };
}

/**
 * Whether the "open an existing one" answer is worth offering: only when the repo has a
 * worktree to open. A button that leads to an empty select is worse than no button.
 */
export function canPickWorktree(status: WorktreeStatus): boolean {
  return status.worktrees.length > 0;
}

/**
 * The answer a tap on one of the three buttons means, pre-filled from the status so the
 * select that follows opens on a usable value rather than on nothing.
 *
 * "no" is the behaviour from before any of this existed: launch in the repo root, create
 * nothing, and ask again next time.
 */
export function worktreeAnswer(kind: WorktreeAnswerKind, status: WorktreeStatus): WorktreeAnswer {
  if (kind === "create") {
    return { kind, baseBranch: defaultBaseBranch(status), worktree: "" };
  }
  if (kind === "pick") {
    return { kind, baseBranch: "", worktree: status.worktrees[0]?.path ?? "" };
  }
  return { kind, baseBranch: "", worktree: "" };
}

/**
 * The three worktree fields a launch body carries, from the answer. One place rather than
 * three: the work session, the Claude session and the terminal all send the same trio,
 * and it used to be hand-copied into each of their POST bodies.
 *
 * An unanswered question (`null`) sends exactly what a launch sent before the question
 * existed. `undefined` rather than `""` for the two optional fields, so a launch that
 * neither creates nor picks puts no meaningless key on the wire.
 */
export function launchWorktreeFields(answer: WorktreeAnswer | null): {
  createWorktree: boolean;
  baseBranch: string | undefined;
  worktree: string | undefined;
} {
  return {
    createWorktree: answer?.kind === "create",
    baseBranch: answer?.baseBranch || undefined,
    worktree: answer?.worktree || undefined,
  };
}
