// The board's filters live in the url and nowhere else. A project name is free text, so
// `project` and `status` repeat, one parameter per value; no separator is safe to join on.

import { byProjectName } from "@/lib/board";

export const FILTER_STATUSES = ["In Review", "In Progress", "Todo", "Backlog"] as const;

export interface BoardFilters {
  projects: string[];
  statuses: string[];
  q: string;
}

export const NO_FILTERS: BoardFilters = { projects: [], statuses: [], q: "" };

// Plain `sort()` (UTF-16 code units), not `localeCompare`: favourites are compared as strings
// across devices, so the canonical form must not depend on the device's locale or ICU.
function normProjects(values: string[]): string[] {
  return [...new Set(values.filter((v) => v !== ""))].sort();
}

function normStatuses(values: string[]): string[] {
  return FILTER_STATUSES.filter((s) => values.includes(s));
}

/** Canonical filters from a url. `q` is kept as typed so the live url keeps a space being typed. */
export function parseFilters(params: URLSearchParams): BoardFilters {
  return {
    projects: normProjects(params.getAll("project")),
    statuses: normStatuses(params.getAll("status")),
    q: params.get("q") ?? "",
  };
}

/** The live url search (no leading "?"); "" when unfiltered. A whitespace-only `q` is omitted. */
export function filterSearch(f: BoardFilters): string {
  const params = new URLSearchParams();
  for (const p of normProjects(f.projects)) params.append("project", p);
  for (const s of normStatuses(f.statuses)) params.append("status", s);
  if (f.q.trim() !== "") params.set("q", f.q);
  return params.toString();
}

/** `filterSearch` with `q` trimmed: the form the url settles to once typing stops. */
export function canonicalSearch(f: BoardFilters): string {
  return filterSearch({ ...f, q: f.q.trim() });
}

export function isFiltered(f: BoardFilters): boolean {
  return f.projects.length > 0 || f.statuses.length > 0 || f.q.trim() !== "";
}

/** What the filter button's badge counts: chips, not the search text. */
export function filterCount(f: BoardFilters): number {
  return f.projects.length + f.statuses.length;
}

/** Projects to offer in the sheet: the configured ones plus any selected one no longer configured. */
export function sheetProjects(configured: string[], selected: string[]): string[] {
  return [...new Set([...configured, ...selected])].sort(byProjectName);
}
