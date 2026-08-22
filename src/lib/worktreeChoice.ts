import type { WorktreeChoice } from "./worktreeOptions";

/**
 * What GET /api/tickets/[id]/worktree-status answers (see getTicketWorktreeStatus).
 * Declared here rather than imported from the server module so the sheet's own model
 * stays testable in the node-only vitest setup, with no route to the git calls behind it.
 */
export interface WorktreeStatus {
  exists: boolean;
  branches: string[];
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
    return { kind, baseBranch: status.defaultBranch ?? status.branches[0] ?? "", worktree: "" };
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
