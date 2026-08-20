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
 * filterTickets and filterSessions, which both narrow on `query.trim()`. `project` is a
 * set and says it with `[]`, `status` is `string | null` and only `null` says it: `""`
 * is a status name like any other. parseLocation already drops absent *and* empty
 * parameters on both, so the conventions never meet.
 *
 * A multi-project selection is one chip listing the names, not one chip each: the bar
 * reports what is hidden and offers to undo it, and the select itself is where an
 * individual project comes back off — a per-project ✕ here would need FilterKey to
 * carry a value, for a control that already exists two rows up.
 */
export function activeFilters(
  { query, project, status, mine, sessionsOnly }: ListFilters,
): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  const trimmed = query.trim();
  if (trimmed !== "") active.push({ key: "query", label: trimmed });
  if (project.length > 0) active.push({ key: "project", label: project.join(", ") });
  if (status !== null) active.push({ key: "status", label: status });
  if (mine) active.push({ key: "mine", label: "Mine" });
  if (sessionsOnly) active.push({ key: "sessions", label: "Sessions" });
  return active;
}
