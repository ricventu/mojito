import type { MergeMode, MergeOutcome } from "./merge.js";

export type QaArg = "approve-local" | "approve-mr";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr"];

export class QaVerdictError extends Error {}

export interface QaVerdictDeps {
  // May throw QaVerdictError for unfixable preconditions (no worktree, unresolvable main
  // checkout); any outcome it RETURNS as conflict/error is one a merge-fix session can work on.
  merge: (mode: MergeMode) => Promise<MergeOutcome>;
  setIssueStatus: (ticket: string, target: string) => Promise<void>;
  // Launches the merge-fix session (it completes the approved merge itself and reports
  // "merged", which moves the ticket to Done). Returns the session's tmux id so the
  // caller can offer to open it.
  launchMergeFix: (detail: string, mode: MergeMode) => Promise<string>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "fix-session"; sessionId: string; detail: string };

/**
 * Resolve a To QA verdict. Approve runs the server-side merge (zero tokens on the clean
 * path) and only launches a session when that merge hits a conflict. There is no reject:
 * a ticket that fails QA is reworked by talking to the session that built it, which is
 * still alive in tmux — Mojito is not in that loop at all.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg },
  deps: QaVerdictDeps,
): Promise<QaVerdictResult> {
  const { ticket, arg } = input;
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
