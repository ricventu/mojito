import type { SessionMeta } from "@mojito/shared";
import type { Db } from "./db";

interface Row {
  id: string;
  kind: SessionMeta["kind"];
  project: string | null;
  ticket: string | null;
  cwd: string;
  model: SessionMeta["model"];
  effort: SessionMeta["effort"];
  state: SessionMeta["state"];
  alert: string | null;
  created_at: number;
  last_event_at: number;
  hidden: number;
}

const toMeta = (r: Row): SessionMeta => ({
  id: r.id,
  kind: r.kind,
  project: r.project,
  ticket: r.ticket,
  cwd: r.cwd,
  model: r.model,
  effort: r.effort,
  state: r.state,
  alert: r.alert,
  createdAt: r.created_at,
  lastEventAt: r.last_event_at,
  hidden: r.hidden === 1,
});

export class SessionsRepo {
  constructor(private db: Db) {}

  list(): SessionMeta[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY created_at, id").all() as Row[]).map(toMeta);
  }

  get(id: string): SessionMeta | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return r ? toMeta(r) : null;
  }

  /** Upsert: a relaunch reuses the id `mj-<TICKET>` and replaces its `ended` row. */
  insert(m: SessionMeta): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions
           (id, kind, project, ticket, cwd, model, effort, state, alert, created_at, last_event_at, hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.kind, m.project, m.ticket, m.cwd, m.model, m.effort, m.state, m.alert, m.createdAt, m.lastEventAt, m.hidden ? 1 : 0);
  }

  patch(id: string, p: Partial<Pick<SessionMeta, "state" | "alert" | "lastEventAt" | "hidden">>): SessionMeta | null {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (p.state !== undefined) (sets.push("state = ?"), values.push(p.state));
    if (p.alert !== undefined) (sets.push("alert = ?"), values.push(p.alert));
    if (p.lastEventAt !== undefined) (sets.push("last_event_at = ?"), values.push(p.lastEventAt));
    if (p.hidden !== undefined) (sets.push("hidden = ?"), values.push(p.hidden ? 1 : 0));
    if (sets.length > 0) this.db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    return this.get(id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  liveForTicket(ticket: string): SessionMeta | null {
    const r = this.db
      .prepare("SELECT * FROM sessions WHERE kind = 'ticket' AND ticket = ? AND state != 'ended' LIMIT 1")
      .get(ticket) as Row | undefined;
    return r ? toMeta(r) : null;
  }
}
