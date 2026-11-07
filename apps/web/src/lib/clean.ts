/**
 * A project's Clean (RIC-528): the project header's button opens the project's clean session,
 * which deletes merged branches and their worktrees once the human confirms. Its badge is the
 * number of linked worktrees, the clutter that tells it is time to clean.
 */

/** The badge text: nothing at 0 or before the count is known, 9+ past nine. */
export function worktreeBadge(count: number | undefined): string | null {
  if (!count) return null;
  return count > 9 ? "9+" : String(count);
}

/** The button's accessible name and tooltip. */
export function cleanLabel(project: string, count: number | undefined): string {
  if (!count) return `Clean ${project}`;
  return `Clean ${project} (${count} worktree${count === 1 ? "" : "s"})`;
}

/** The toast as the session's terminal opens. */
export function cleanMessage(alreadyOpen: boolean): string {
  return alreadyOpen ? "The clean session is already open" : "Claude is looking for merged branches and worktrees";
}
