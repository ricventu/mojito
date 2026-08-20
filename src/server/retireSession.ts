import type { Registry } from "./registry";

export interface RetireDeps {
  hasSession: (name: string) => Promise<boolean>;
  registry: Registry;
}

/**
 * Drop the registration of a session whose tmux is already gone, so a ticket does not carry
 * a dead entry into its next stage (and so the tmux name is free for a relaunch).
 *
 * Mojito never ends a session on its own. This used to be `supersedeSession`, which closed
 * the predecessor (Ctrl-C, Ctrl-D, then kill-session) before deregistering it — so approving
 * at the QA gate killed the ticket's work session even while it was mid-turn, and that
 * session is the rework channel the whole gate depends on. A session now ends only on an
 * explicit user action: the Kill button, i.e. DELETE /api/sessions/[id]. A live one is left
 * exactly as it is, however finished Mojito believes its stage to be.
 *
 * Returns whether the registration was dropped (false = still alive, left alone).
 */
export async function retireDeadSession(prevId: string, deps: RetireDeps): Promise<boolean> {
  if (await deps.hasSession(prevId)) return false;
  deps.registry.remove(prevId); // also removes the sidecar
  return true;
}
