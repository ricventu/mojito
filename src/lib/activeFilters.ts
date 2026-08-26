import type { ListFilters } from "./appLocation";

/** Identifies which of the unified list's five filters an entry came from. */
export type FilterKey = "query" | "project" | "status" | "mine" | "sessions";

/** One filter currently narrowing the list, and the text that names it to the user. */
export interface ActiveFilter {
  key: FilterKey;
  label: string;
  /**
   * Which one of a multi-valued filter's values this entry stands for — only
   * `project` has any, and removing the entry removes just that value. Absent means
   * the entry stands for the whole filter, which is every other key and also the way
   * a project chip would clear the entire selection.
   */
  value?: string;
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
 * A multi-project selection is one chip per project, each carrying its own name as
 * `value` (RIC-252). It used to be a single chip listing them all, on the grounds that
 * the select two rows up is where an individual project comes back off — but the chip's
 * ✕ is the only removal the sticky bar offers, and it took the whole selection with it:
 * the way back to one project was to reopen the select and untick, which reads as the
 * bar refusing to undo what it reports. Clear all still drops the lot at once.
 */
export function activeFilters(
  { query, project, status, mine, sessionsOnly }: ListFilters,
): ActiveFilter[] {
  const active: ActiveFilter[] = [];
  const trimmed = query.trim();
  if (trimmed !== "") active.push({ key: "query", label: trimmed });
  for (const p of project) active.push({ key: "project", label: p, value: p });
  if (status !== null) active.push({ key: "status", label: status });
  if (mine) active.push({ key: "mine", label: "Mine" });
  if (sessionsOnly) active.push({ key: "sessions", label: "Sessions" });
  return active;
}

/**
 * The filters left once the given entry is removed — the pure half of the sticky bar's
 * ✕, kept out of the component so it is testable without a DOM (the usual split).
 *
 * A Record rather than a switch: TypeScript requires every FilterKey to have an entry,
 * so a new filter fails to compile here instead of silently no-op'ing when its chip is
 * tapped. Every branch returns a fresh object — the caller hands the result straight to
 * the url, and a mutated `project` array would be the same reference React is holding.
 */
export function removeFilter(filters: ListFilters, { key, value }: ActiveFilter): ListFilters {
  const without: Record<FilterKey, () => ListFilters> = {
    query: () => ({ ...filters, query: "" }),
    // Undefined `value` means the chip stands for the whole selection; a value that is
    // no longer selected simply filters nothing out, which is the right answer for a
    // chip tapped after the url moved on under it.
    project: () => ({
      ...filters,
      project: value === undefined ? [] : filters.project.filter((p) => p !== value),
    }),
    status: () => ({ ...filters, status: null }),
    mine: () => ({ ...filters, mine: false }),
    sessions: () => ({ ...filters, sessionsOnly: false }),
  };
  return without[key]();
}
