import type { GitOp, GitSyncResult } from "@mojito/shared";

const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/**
 * What the board does with a project's Pull or Push answer: a toast, or — on a conflict, which
 * the server has handed to the project's git session — that session's terminal, opened.
 */
export function gitSyncAction(
  op: GitOp,
  result: GitSyncResult,
): { kind: "toast"; message: string } | { kind: "open"; sessionId: string; message: string } {
  switch (result.status) {
    case "updated":
      return { kind: "toast", message: `Pulled ${commits(result.commits)} into ${result.branch}` };
    case "up-to-date":
      return { kind: "toast", message: op === "pull" ? `${result.branch} is already up to date` : `Nothing to push on ${result.branch}` };
    case "pushed":
      return {
        kind: "toast",
        message:
          result.pulled > 0
            ? `Pulled ${commits(result.pulled)}, then pushed ${commits(result.commits)} to ${result.branch}`
            : `Pushed ${commits(result.commits)} to ${result.branch}`,
      };
    case "conflict": {
      const label = op === "pull" ? "Pull" : "Push";
      return {
        kind: "open",
        sessionId: result.session.id,
        message: `${label} hit a conflict: ${result.alreadyOpen ? "the git session is already open" : "Claude is resolving it"}`,
      };
    }
  }
}
