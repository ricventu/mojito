import type { TaskRecord } from "@mojito/shared";
import type { Db } from "./db";

interface Row {
  id: string;
  type: TaskRecord["type"];
  input: string;
  status: TaskRecord["status"];
  log: string;
  error: string | null;
  result: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
}

// A JSON column that does not parse (a hand-edited or truncated row) reads as its fallback
// instead of throwing out of every list() — one bad row would take the whole task panel down.
function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const toTask = (r: Row): TaskRecord => ({
  id: r.id,
  type: r.type,
  input: parseJson(r.input, { project: "", note: "", imageUrls: [] }),
  status: r.status,
  log: parseJson(r.log, []),
  error: r.error,
  result: parseJson(r.result, null),
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class TasksRepo {
  constructor(private db: Db) {}

  list(): TaskRecord[] {
    return (this.db.prepare("SELECT * FROM sdk_tasks ORDER BY created_at, id").all() as Row[]).map(toTask);
  }

  get(id: string): TaskRecord | null {
    const r = this.db.prepare("SELECT * FROM sdk_tasks WHERE id = ?").get(id) as Row | undefined;
    return r ? toTask(r) : null;
  }

  insert(t: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO sdk_tasks (id, type, input, status, log, error, result, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.type,
        JSON.stringify(t.input),
        t.status,
        JSON.stringify(t.log),
        t.error,
        t.result === null ? null : JSON.stringify(t.result),
        t.archived ? 1 : 0,
        t.createdAt,
        t.updatedAt,
      );
  }

  /** Patches the fields `p` sets; one present but `undefined` is left as it was, not bound as such. */
  update(id: string, p: Partial<TaskRecord>): TaskRecord | null {
    const cur = this.get(id);
    if (!cur) return null;
    const set = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
    const next: TaskRecord = { ...cur, ...set, id };
    this.db
      .prepare(
        `UPDATE sdk_tasks SET type = ?, input = ?, status = ?, log = ?, error = ?, result = ?, archived = ?,
           created_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.type,
        JSON.stringify(next.input),
        next.status,
        JSON.stringify(next.log),
        next.error,
        next.result === null ? null : JSON.stringify(next.result),
        next.archived ? 1 : 0,
        next.createdAt,
        next.updatedAt,
        id,
      );
    return next;
  }

  appendLog(id: string, line: string): TaskRecord | null {
    const cur = this.get(id);
    return cur ? this.update(id, { log: [...cur.log, line] }) : null;
  }

  /** Startup reconciliation: work in flight at shutdown never finished. */
  failInterrupted(now: number): number {
    return this.db
      .prepare("UPDATE sdk_tasks SET status = 'failed', error = 'interrotto dal riavvio', updated_at = ? WHERE status IN ('queued', 'running')")
      .run(now).changes;
  }
}
