import { DEFAULT_PROMPTS, TICKET_PLACEHOLDER, type GitOp } from "@mojito/shared";
import type { SyncConflict } from "../git/sync";

/**
 * The whole prompt a ticket session starts with: the ticket prompt from Settings (the shipped
 * one by default, see `DEFAULT_PROMPTS`) with every `{ticket}` replaced by the identifier.
 * A test fixes the default's text byte for byte.
 */
export function buildTicketPrompt(ticket: string, template: string = DEFAULT_PROMPTS.ticket): string {
  // split/join rather than replaceAll with a string: the identifier is inserted literally.
  return template.split(TICKET_PLACEHOLDER).join(ticket);
}

/**
 * The whole prompt of the session Mojito opens when a project's Pull or Push stops short (see
 * `git/sync.ts`): which operation, on which branch, and git's own account of why. The repo is
 * as it was before Mojito tried; the session does the reconciling Mojito would not decide on.
 * Ticket sessions share the checkout, hence the care with uncommitted changes.
 */
export function buildGitResolvePrompt(op: GitOp, conflict: Pick<SyncConflict, "branch" | "upstream" | "reason">): string {
  const { branch, upstream, reason } = conflict;
  const label = op === "pull" ? "Pull" : "Push";
  return [
    `Mojito's ${label} of branch ${branch} in this repository stopped before finishing, and left the repository as it was. Its reason:`,
    reason,
    `Bring ${branch} up to date with ${upstream}: look at the divergence (git status, git log --oneline --graph ${branch} ${upstream}) and reconcile it — rebase the local commits onto ${upstream} or merge, whichever fits — resolving every conflict so that the intent of both sides survives. Run the project's checks if it has them.`,
    "Other Claude sessions may be working in this same checkout: never discard commits or uncommitted changes, never reset them away, and never force-push. Uncommitted changes that are not yours may be another session's work in progress: if you must move them out of the way, put them back afterwards exactly as they were.",
    op === "push" ? `When ${branch} is up to date with ${upstream} and builds, then push it (a plain push).` : "Do not push.",
    "If something cannot be resolved safely, say so and stop.",
  ].join("\n");
}
