import type { MergeMode, MergeOutcome } from "./merge.js";

export type QaArg = "approve-local" | "approve-mr" | "reject";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr", "reject"];

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  launchRework: (rejectReason: string) => Promise<void>;
  launchConflictFix: (detail: string) => Promise<void>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "conflict-session" }
  | { done: "rework-session" };

/**
 * Resolve a To QA verdict. Approve runs the server-side merge (zero tokens on the
 * clean path) and only launches a session on rebase conflict; reject sends the reason
 * to the next work session through its context file — nothing is posted to Linear.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg; reason?: string },
  deps: QaVerdictDeps,
): Promise<QaVerdictResult> {
  const { ticket, arg, reason } = input;
  if (arg === "reject") {
    const trimmed = (reason ?? "").trim();
    if (!trimmed) throw new QaVerdictError("rejection reason required");
    await deps.setIssueStatus(ticket, "In Progress");
    await deps.launchRework(trimmed);
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
    case "conflict":
      // The branch is not merged and history was not moved: leave the ticket at To QA
      // so the conflict-fix session's own result can drive the next transition.
      await deps.launchConflictFix(outcome.detail);
      return { done: "conflict-session" };
    case "error":
      throw new QaVerdictError(`merge failed: ${outcome.detail}`);
  }
}
