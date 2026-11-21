// The board's filters live in the url and nowhere else. A project or label name is free text, so
// `project`, `status` and `label` repeat, one parameter per value; no separator is safe to join on.
// `live=1` narrows to what has a live session.

import { byProjectName } from "@/lib/board";

/** The workflow's sequence: the sheet's order and the url's canonical one. */
export const FILTER_STATUSES = ["Backlog", "Todo", "In Progress", "In Review"] as const;

export interface BoardFilters {
  projects: string[];
  statuses: string[];
  /** Linear label names; a ticket carrying any of them matches (RIC-609). */
  labels: string[];
  /** Only what has a live (not ended) session: the sheet's "Active" under Sessions. */
  live: boolean;
  q: string;
}

export const NO_FILTERS: BoardFilters = { projects: [], statuses: [], labels: [], live: false, q: "" };

// Plain `sort()` (UTF-16 code units), not `localeCompare`: favourites are compared as strings
// across devices, so the canonical form must not depend on the device's locale or ICU.
function normNames(values: string[]): string[] {
  return [...new Set(values.filter((v) => v !== ""))].sort();
}

function normStatuses(values: string[]): string[] {
  return FILTER_STATUSES.filter((s) => values.includes(s));
}

/** Canonical filters from a url. `q` is kept as typed so the live url keeps a space being typed. */
export function parseFilters(params: URLSearchParams): BoardFilters {
  return {
    projects: normNames(params.getAll("project")),
    statuses: normStatuses(params.getAll("status")),
    labels: normNames(params.getAll("label")),
    live: params.get("live") === "1",
    q: params.get("q") ?? "",
  };
}

/** The live url search (no leading "?"); "" when unfiltered. A whitespace-only `q` is omitted. */
export function filterSearch(f: BoardFilters): string {
  const params = new URLSearchParams();
  for (const p of normNames(f.projects)) params.append("project", p);
  for (const s of normStatuses(f.statuses)) params.append("status", s);
  for (const l of normNames(f.labels)) params.append("label", l);
  if (f.live) params.set("live", "1");
  if (f.q.trim() !== "") params.set("q", f.q);
  return params.toString();
}

/** `filterSearch` with `q` trimmed: the form the url settles to once typing stops. */
export function canonicalSearch(f: BoardFilters): string {
  return filterSearch({ ...f, q: f.q.trim() });
}

export function isFiltered(f: BoardFilters): boolean {
  return f.projects.length > 0 || f.statuses.length > 0 || f.labels.length > 0 || f.live || f.q.trim() !== "";
}

/** What the filter button's badge counts: chips, not the search text. */
export function filterCount(f: BoardFilters): number {
  return f.projects.length + f.statuses.length + f.labels.length + (f.live ? 1 : 0);
}

/** Projects to offer in the sheet: the configured ones plus any selected one no longer configured. */
export function sheetProjects(configured: string[], selected: string[]): string[] {
  return [...new Set([...configured, ...selected])].sort(byProjectName);
}
