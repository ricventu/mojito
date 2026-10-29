import { readFileSync } from "node:fs";
import type { ProjectRow } from "@mojito/shared";
import type { Db } from "./db";
import type { SettingsRepo } from "./settings";

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

  isEmpty(): boolean {
    return this.db.prepare("SELECT 1 FROM projects LIMIT 1").get() === undefined;
  }
}

/**
 * The boot-time import of projects.json, at most once per database. Keyed on a flag rather than
 * on an empty table: a human who deletes every project in Settings means it, and the old file
 * must not come back on the next restart. The flag is set after the first attempt whatever it
 * found — a database that already holds projects (imported before the flag existed) gets it
 * too, without re-reading the file. Answers the rows written, or null when the import was
 * skipped.
 */
export function importProjectsOnce(repo: ProjectsRepo, settings: SettingsRepo, path: string): number | null {
  if (settings.projectsImported()) return null;
  const imported = repo.isEmpty() ? importProjectsJson(repo, path) : null;
  settings.markProjectsImported();
  return imported;
}

type Entry = string | { path?: string; projects?: Record<string, string> };

/**
 * One-time import of the old app's projects.json (Record<teamKey, path | { path, projects }>).
 * Returns the number of rows written; 0 for a missing or malformed file, never throws.
 */
export function importProjectsJson(repo: ProjectsRepo, path: string): number {
  let map: Record<string, Entry>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    map = parsed as Record<string, Entry>;
  } catch {
    return 0;
  }
  const rows: ProjectRow[] = [];
  for (const [teamKey, entry] of Object.entries(map)) {
    if (typeof entry === "string") {
      rows.push({ name: teamKey, path: entry, teamKey });
    } else if (entry && typeof entry === "object") {
      const nested = entry.projects && typeof entry.projects === "object" ? Object.entries(entry.projects) : [];
      if (nested.length > 0) {
        for (const [name, p] of nested) if (typeof p === "string") rows.push({ name, path: p, teamKey });
      } else if (typeof entry.path === "string") {
        rows.push({ name: teamKey, path: entry.path, teamKey });
      }
    }
  }
  for (const r of rows) repo.upsert(r);
  return rows.length;
}
