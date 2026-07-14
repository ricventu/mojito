export type QaArg = "approve" | "reject";

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  postComment: (ticket: string, body: string) => Promise<void>;
}

/**
 * Resolve a To QA verdict without launching a claude session:
 *  - approve -> set status To Merge (no comment).
 *  - reject  -> post the rejection reason as a comment, then set status To Code.
 * Comment is posted before the status change so a rejection is never statused
 * back without its reason on record.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg; reason?: string },
  deps: QaVerdictDeps,
): Promise<void> {
  const { ticket, arg, reason } = input;
  if (arg === "approve") {
    await deps.setIssueStatus(ticket, "To Merge");
    return;
  }
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new QaVerdictError("rejection reason required");
  await deps.postComment(ticket, `QA rejected — ${trimmed}`);
  await deps.setIssueStatus(ticket, "To Code");
}
