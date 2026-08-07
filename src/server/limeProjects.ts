import { readFileSync } from "node:fs";

export type ProjectMap = Record<string, string | { path: string; projects?: Record<string, string> }>;

export function loadProjectMap(path: string): ProjectMap {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ProjectMap;
  } catch {
    return {};
  }
}

export function resolveRepoFromMap(
  map: ProjectMap,
  teamKey: string,
  projectName: string | null,
): string | null {
  const entry = map[teamKey];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  if (projectName && entry.projects && entry.projects[projectName]) return entry.projects[projectName];
  return entry.path ?? null;
}

export function listMappedProjects(map: ProjectMap): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry === "string") {
      out.push({ name: key, path: entry });
    } else if (entry.projects && Object.keys(entry.projects).length > 0) {
      for (const [name, path] of Object.entries(entry.projects)) out.push({ name, path });
    } else if (entry.path) {
      out.push({ name: key, path: entry.path });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function resolvePathForProject(map: ProjectMap, name: string): string | null {
  return listMappedProjects(map).find((p) => p.name === name)?.path ?? null;
}

/**
 * Resolve the team key that owns a project name, for issue creation. Falls back to the
 * map's first key when the name is unmapped (or null, e.g. "General"); null for an
 * empty map, since there is no team to fall back to.
 */
export function teamKeyForProject(map: ProjectMap, projectName: string | null): string | null {
  if (projectName) {
    for (const [key, entry] of Object.entries(map)) {
      if (typeof entry !== "string" && entry.projects && Object.prototype.hasOwnProperty.call(entry.projects, projectName)) return key;
    }
  }
  return Object.keys(map)[0] ?? null;
}
