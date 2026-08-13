import type { MergeMode, MergeOutcome } from "./merge.js";

export type QaArg = "approve-local" | "approve-mr" | "mark-done";
export const QA_ARGS: readonly QaArg[] = ["approve-local", "approve-mr", "mark-done"];

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
  // Whether an approve would have nothing to do — the branch already landed, or the work
  // never took a branch of its own. Asked only by mark-done.
  nothingToMerge: () => Promise<boolean>;
}

export type QaVerdictResult =
  | { done: "merged"; commit: string }
  | { done: "mr-created"; url: string }
  | { done: "fix-session"; sessionId: string; detail: string }
  | { done: "marked-done" };

/**
 * Resolve a To QA verdict. Approve runs the server-side merge (zero tokens on the clean
 * path) and only launches a session when that merge hits a conflict. mark-done skips git
 * entirely for a branch that already landed outside Mojito (or never took one), writing
 * Done straight after re-checking that there is truly nothing left to merge. There is no
 * reject: a ticket that fails QA is reworked by talking to the session that built it, which
 * is still alive in tmux — Mojito is not in that loop at all.
 */
export async function resolveQaVerdict(
  input: { ticket: string; arg: QaArg },
  deps: QaVerdictDeps,
): Promise<QaVerdictResult> {
  const { ticket, arg } = input;
  if (arg === "mark-done") {
    // Nothing for a merge to do: someone landed the branch outside Mojito, or the work never
    // took a branch. Either way only the board is behind. Re-check rather than trust the gate —
    // it decided seconds ago, and writing Done over unmerged commits would strand them.
    if (!(await deps.nothingToMerge())) throw new QaVerdictError("branch has unmerged commits");
    await deps.setIssueStatus(ticket, "Done");
    return { done: "marked-done" };
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
