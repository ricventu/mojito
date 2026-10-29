import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import { PREFIX } from "../tmux/tmux";
import { kindFromId, ticketFromId } from "./hooks";

/**
 * Mark a session whose tmux is gone as `ended` (alert cleared) and tell every board. A row that
 * is missing or already ended is left alone; answers whether anything changed.
 */
export function markEnded(id: string, deps: { sessions: SessionsRepo; bus: EventBus; now(): number }): boolean {
  const row = deps.sessions.get(id);
  if (!row || row.state === "ended") return false;
  const session = deps.sessions.patch(id, { state: "ended", alert: null, lastEventAt: deps.now() });
  if (session) deps.bus.emit({ type: "session.updated", session });
  return true;
}

export interface ReconcileDeps {
  sessions: SessionsRepo;
  listTmux(): Promise<string[]>;
  bus: EventBus;
  now(): number;
}

/**
 * Bring the table in line with tmux after a restart: a row whose tmux is gone has ended, and a
 * `mj-*` tmux session with no row is adopted. A live row with a live tmux is kept as it is; an
 * `ended` row whose tmux is alive was ended wrongly (a missed or misread hook) and comes back
 * as `idle` — tmux is the ground truth, so every such mistake heals at the next boot.
 */
export async function reconcileSessions(
  deps: ReconcileDeps,
): Promise<{ ended: string[]; adopted: string[]; revived: string[] }> {
  const live = new Set((await deps.listTmux()).filter((n) => n.startsWith(PREFIX)));
  const rows = deps.sessions.list();
  const known = new Set(rows.map((r) => r.id));
  const ended: string[] = [];
  const adopted: string[] = [];
  const revived: string[] = [];

  for (const row of rows) {
    if (row.state === "ended" && live.has(row.id)) {
      const session = deps.sessions.patch(row.id, { state: "idle", alert: null, lastEventAt: deps.now() });
      if (session) deps.bus.emit({ type: "session.updated", session });
      revived.push(row.id);
      continue;
    }
    if (row.state === "ended" || live.has(row.id)) continue;
    if (markEnded(row.id, deps)) ended.push(row.id);
  }

  for (const id of live) {
    if (known.has(id)) continue;
    const now = deps.now();
    const session = {
      id,
      kind: kindFromId(id),
      project: null,
      ticket: ticketFromId(id),
      cwd: "",
      model: null,
      effort: null,
      state: "idle" as const,
      alert: null,
      createdAt: now,
      lastEventAt: now,
      hidden: false,
    };
    deps.sessions.insert(session);
    deps.bus.emit({ type: "session.updated", session });
    adopted.push(id);
  }

  return { ended, adopted, revived };
}
