import { commandsFor, type Command } from "@mojito/shared";

/**
 * A project's quick commands (RIC-581). Clean (RIC-528) is the default one: it keeps its own
 * button on the project header, with a badge of the linked worktrees — the clutter that tells it
 * is time to clean. Every other command is in the header's commands menu.
 */

/** The badge text: nothing at 0 or before the count is known, 9+ past nine. */
export function worktreeBadge(count: number | undefined): string | null {
  if (!count) return null;
  return count > 9 ? "9+" : String(count);
}

/** Clean's accessible name and tooltip. */
export function cleanLabel(project: string, count: number | undefined): string {
  if (!count) return `Clean ${project}`;
  return `Clean ${project} (${count} worktree${count === 1 ? "" : "s"})`;
}

/** The toast as a command's terminal opens. */
export function commandMessage(name: string, alreadyOpen: boolean): string {
  return alreadyOpen ? `${name} is already open` : `Started ${name}`;
}

/** The commands the header's menu lists: the project's, except Clean (it has its own button). */
export function menuCommands(effective: Command[], project: string): Command[] {
  return commandsFor(effective, project).filter((c) => c.id !== "clean");
}

/** The project's Clean, if it is offered (it can be removed or limited to other projects). */
export function boardClean(effective: Command[], project: string): Command | undefined {
  return commandsFor(effective, project).find((c) => c.id === "clean");
}
