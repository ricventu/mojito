import type { MergeMode, MergeOutcome } from "./merge.js";

export type QaArg = "approve-local" | "approve-mr" | "reject";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr", "reject"];

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  launchRework: (rejectReason: string) => Promise<void>;
  // Returns the launched session's tmux id, so the caller can offer to open it.
  launchConflictFix: (detail: string) => Promise<string>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "conflict-session"; sessionId: string }
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
  const outcome = await deps.merge(arg === "approve-local" ? "local" : "mr");
  switch (outcome.status) {
    case "merged":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "merged", commit: outcome.commit };
    case "mr-created":
      await deps.setIssueStatus(ticket, "Done");
      return { done: "mr-created", url: outcome.url };
    case "conflict": {
      // The branch is not merged and history was not moved: leave the ticket at To QA
      // so the conflict-fix session's own result can drive the next transition.
      const sessionId = await deps.launchConflictFix(outcome.detail);
      return { done: "conflict-session", sessionId };
    }
    case "error":
      throw new QaVerdictError(`merge failed: ${outcome.detail}`);
  }
}
