import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { filterSearch, parseFilters, type BoardFilters } from "@/lib/filters";
import { rememberBoardSearch } from "@/lib/boardReturn";

/**
 * The board's filters, read from and written to the url. Every write replaces the history
 * entry, so Back leaves the board instead of undoing one chip at a time. The search is also
 * remembered for the terminal's Board link — on mount too, so a bookmarked board counts.
 */
export function useBoardFilters(): [BoardFilters, (next: BoardFilters) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const search = filterSearch(filters);

  useEffect(() => rememberBoardSearch(search), [search]);

  const setFilters = useCallback(
    (next: BoardFilters) => setParams(new URLSearchParams(filterSearch(next)), { replace: true }),
    [setParams],
  );
  return [filters, setFilters];
}
