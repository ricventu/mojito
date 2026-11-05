import type { ProjectRow } from "@mojito/shared";
import type { Db } from "./db";

interface Row {
  name: string;
  path: string;
  team_key: string;
}

const toProject = (r: Row): ProjectRow => ({ name: r.name, path: r.path, teamKey: r.team_key });

export class ProjectsRepo {
  constructor(private db: Db) {}

  list(): ProjectRow[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE").all() as Row[]).map(toProject);
  }

  get(name: string): ProjectRow | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Row | undefined;
    return r ? toProject(r) : null;
  }

  upsert(p: ProjectRow): void {
    this.db
      .prepare(
        "INSERT INTO projects (name, path, team_key) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET path = excluded.path, team_key = excluded.team_key",
      )
      .run(p.name, p.path, p.teamKey);
  }

  /** Moves `old` to `p.name`; throws, changing nothing, when another project already has that name. */
  rename(old: string, p: ProjectRow): void {
    this.db.transaction(() => {
      if (p.name !== old && this.get(p.name)) throw new Error(`project already exists: ${p.name}`);
      this.db.prepare("DELETE FROM projects WHERE name = ?").run(old);
      this.upsert(p);
    })();
  }

  remove(name: string): void {
    this.db.prepare("DELETE FROM projects WHERE name = ?").run(name);
  }
}
