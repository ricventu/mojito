import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import type { closeSession } from "../tmux/tmux";

export interface KillDeps {
  sessions: SessionsRepo;
  bus: EventBus;
  closeSession: typeof closeSession;
  now?(): number;
}

/**
 * The one path that closes a session, behind the Kill button. It asks claude to leave and never
 * forces it: when claude will not, the answer is 409 and nothing about the session changes.
 */
export async function killSession(id: string, deps: KillDeps): Promise<{ status: 200 | 404 | 409 }> {
  const row = deps.sessions.get(id);
  if (!row) return { status: 404 };
  if (row.state === "ended") return { status: 200 };
  const { closed } = await deps.closeSession(id);
  if (!closed) return { status: 409 };
  const session = deps.sessions.patch(id, { state: "ended", alert: null, lastEventAt: (deps.now ?? Date.now)() });
  if (session) deps.bus.emit({ type: "session.updated", session });
  return { status: 200 };
}
