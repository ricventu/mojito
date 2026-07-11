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
