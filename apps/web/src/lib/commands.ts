import { commandsFor, type Command } from "@mojito/shared";
import { ApiError } from "@/lib/api";
import { hostApi } from "@/lib/host";

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

/** The toast as a command's terminal opens; `host` names the peer it ran on. */
export function commandMessage(name: string, alreadyOpen: boolean, host: string | null = null): string {
  const on = host === null ? "" : ` on ${host}`;
  return alreadyOpen ? `${name} is already open${on}` : `Started ${name}${on}`;
}

/** The run sheet's route (RIC-622) on this instance, or on a peer through the relay. */
export function commandRunPath(host: string | null, project: string, id: string): string {
  return hostApi(host, `/api/projects/${encodeURIComponent(project)}/commands/${encodeURIComponent(id)}/run`);
}

/**
 * A failed run's toast. A peer without the run route answers the catch-all 404 (`not found`):
 * it runs an older Mojito, which a bare "not found" would not tell.
 */
export function commandRunError(name: string, err: unknown, host: string | null): string {
  if (host !== null && err instanceof ApiError && err.status === 404 && err.message === "not found") {
    return `${name} failed: ${host} runs an older Mojito, update it to run commands there`;
  }
  return `${name} failed: ${err instanceof Error ? err.message : "unknown error"}`;
}

/** The commands the header's menu lists: the project's, except Clean (it has its own button). */
export function menuCommands(effective: Command[], project: string): Command[] {
  return commandsFor(effective, project).filter((c) => c.id !== "clean");
}

/** The project's Clean, if it is offered (it can be removed or limited to other projects). */
export function boardClean(effective: Command[], project: string): Command | undefined {
  return commandsFor(effective, project).find((c) => c.id === "clean");
}
