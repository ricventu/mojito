import type { MergeMode, MergeOutcome } from "./merge.js";

export type QaArg = "approve-local" | "approve-mr" | "reject";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr", "reject"];

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  // May throw QaVerdictError for unfixable preconditions (no worktree, unresolvable main
  // checkout); any outcome it RETURNS as conflict/error is one a merge-fix session can work on.
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  launchRework: (rejectReason: string) => Promise<void>;
  // Launches the merge-fix session (it completes the approved merge itself and reports
  // "merged", which moves the ticket to Done). Returns the session's tmux id so the
  // caller can offer to open it.
  launchMergeFix: (detail: string, mode: MergeMode) => Promise<string>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "fix-session"; sessionId: string; detail: string }
  | { done: "rework-session" };

/**
 * Resolve a To QA verdict. Approve runs the server-side merge (zero tokens on the
 * clean path) and only launches a session when that merge hits a conflict; reject
 * sends the reason to the next work session through its context file — nothing is
 * posted to Linear.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg; reason?: string },
  deps: QaVerdictDeps,
): Promise<QaVerdictResult> {
  const { ticket, arg, reason } = input;
  if (arg === "reject") {
    const trimmed = (reason ?? "").trim();
    if (!trimmed) throw new QaVerdictError("rejection reason required");
    // Launch first, status second. The reason exists only in the launched session's context
    // file, so a failed launch must leave the ticket at To QA: the reject is then simply
    // retried with the reason intact, instead of stranding the ticket at In Progress where
    // the To-QA guard would 409 every retry and the typed reason would be lost. The inverse
    // failure is benign — a status write that fails after a successful launch only lags the
    // board until the session's own move to To QA.
    await deps.launchRework(trimmed);
    await deps.setIssueStatus(ticket, "In Progress");
    return { done: "rework-session" };
  }
  const mode: MergeMode = arg === "approve-local" ? "local" : "mr";
  const outcome = await deps.merge(mode);
  switch (outcome.status) {
    case "merged":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "merged", commit: outcome.commit };
    case "mr-created":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "mr-created", url: outcome.url };
    case "conflict":
    case "error": {
      // The merge is approved but could not complete on its own (conflict, diverged
      // default branch, dirty worktree, ...). The ticket stays at To QA and the
      // merge-fix session finishes the job — its "merged" result moves it to Done.
      const sessionId = await deps.launchMergeFix(outcome.detail, mode);
      return { done: "fix-session", sessionId, detail: outcome.detail };
    }
  }
}
