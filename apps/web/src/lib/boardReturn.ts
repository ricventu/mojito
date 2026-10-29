/** sessionStorage key of the board's last search: per browser tab, so two tabs keep two filter sets. */
export const BOARD_SEARCH_KEY = "mojito2-board-search";

function defaultStore(): Storage | null {
  return typeof sessionStorage !== "undefined" ? sessionStorage : null;
}

/**
 * Remember the board's search so the terminal's Board link (and Kill) can return to it.
 * Best effort: a store that throws (Safari private mode) or no store means nothing is kept.
 */
export function rememberBoardSearch(search: string, store: Storage | null = defaultStore()): void {
  try {
    store?.setItem(BOARD_SEARCH_KEY, search);
  } catch {
    // Nothing remembered: the Board link falls back to "/".
  }
}

/** Where the Board link goes: `/?<search>` when a search is remembered, else `/`. */
export function boardHref(store: Storage | null = defaultStore()): string {
  try {
    const search = store?.getItem(BOARD_SEARCH_KEY);
    return search ? `/?${search}` : "/";
  } catch {
    return "/";
  }
}
