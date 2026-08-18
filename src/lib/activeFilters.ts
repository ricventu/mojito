import type { ListFilters } from "./appLocation";

/** Identifies which of the unified list's five filters an entry came from. */
export type FilterKey = "query" | "project" | "status" | "mine" | "sessions";

/** One filter currently narrowing the list, and the text that names it to the user. */
export interface ActiveFilter {
  key: FilterKey;
  label: string;
}

/**
 * The filters currently narrowing the unified list, query first — it is the one that
 * scrolls out of sight behind the list, so it leads the sticky bar that reports them.
 *
 * An empty array means the list is showing everything. That is what lets ActiveFilters
 * decide on its own whether to render, instead of every caller testing five values.
 *
 * `query` is a bare string, so emptiness is how it says "unset" — trimmed, to match
 * filterTickets and filterSessions, which both narrow on `query.trim()`. `project` and
 * `status` are `string | null`, where only `null` says it: `""` is a value like any
 * other. parseLocation already reads an absent *or* empty `project`/`status` parameter
 * as `null`, so the two conventions never meet.
 */
export function activeFilters(
  { query, project, status, mine, sessionsOnly }: ListFilters,
): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  const trimmed = query.trim();
  if (trimmed !== "") active.push({ key: "query", label: trimmed });
  if (project !== null) active.push({ key: "project", label: project });
  if (status !== null) active.push({ key: "status", label: status });
  if (mine) active.push({ key: "mine", label: "Mine" });
  if (sessionsOnly) active.push({ key: "sessions", label: "Sessions" });
  return active;
}
