import { filterSearch, NO_FILTERS, parseFilters, type AppLocation, type ListFilters } from "./appLocation";

/**
 * Where the board's last filter set is remembered. One key, holding the same query
 * string the address bar writes — not the five `mojito-list-*` keys RIC-204 removed,
 * and not a live copy of the filter state: see seedFilters for what it is allowed to
 * decide.
 */
export const FILTER_KEY = "mojito-list-filters";

/**
 * Does this set deviate from the board's defaults at all? The predicate both halves
 * below turn on.
 *
 * "Deviates", not "narrows": since RIC-275 those are two different questions, because
 * `backlog` defaults to hidden and so *widens* the board when it is set. Both callers
 * want deviation — one asks "does the url already say something?", the other "did the
 * user leave a preference worth restoring?" — and showing the Backlog answers yes to
 * each, even though it narrows nothing.
 */
function narrowed(filters: ListFilters): boolean {
  return (
    filters.query !== "" ||
    filters.project.length > 0 ||
    filters.status !== null ||
    filters.mine ||
    filters.sessionsOnly ||
    filters.backlog !== NO_FILTERS.backlog
  );
}

/**
 * The filters a cold start should be seeded with, or `null` to leave the url alone.
 *
 * The address bar stays the single source of truth (RIC-204): this answers a value
 * only for the *first* load of a board that carries no filters of its own, which is
 * what makes reopening the app — the PWA's `start_url` is a bare `/` — land back on
 * what you were looking at. Three refusals, each load-bearing:
 *
 * - a url that already names filters wins outright, so a shared link, a bookmark and
 *   a reloaded second tab all mean exactly what they say;
 * - only the list is seeded, since `sessionUrl` builds a terminal url deliberately
 *   clean of filters and a docs overlay is not the board either;
 * - a remembered set that deviates from nothing is not restored, which is how clearing
 *   every filter stays cleared on the next launch.
 */
export function seedFilters(location: AppLocation, stored: string | null): ListFilters | null {
  if (location.view.kind !== "list" || narrowed(location.filters)) return null;
  if (stored === null || stored === "") return null;
  const remembered = parseFilters(stored);
  return narrowed(remembered) ? remembered : null;
}

/**
 * What to write to storage for this location, or `null` to leave what is there.
 *
 * Only the list writes. Opening a session in a new browser tab (RIC-224) lands on
 * `/session/<id>` with no filters at all, so a view-blind write would wipe the
 * remembered set on every such open — the filters are the *board's*, and only the
 * board is in a position to report them.
 */
export function filtersToRemember(location: AppLocation): string | null {
  return location.view.kind === "list" ? filterSearch(location.filters) : null;
}
