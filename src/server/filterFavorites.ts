import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./config";
import { validateFavorites, type FilterFavorite } from "@/lib/filterFavorites";

let cache: FilterFavorite[] | undefined;

/**
 * The board's saved filter favourites (RIC-306), beside the other config files rather
 * than in `stateDir`: this is something the human curated, like projects.json and
 * stage-defaults.json, where stateDir holds per-session machine state — contexts,
 * results, drafts — that Mojito writes and reads back on its own.
 */
export function favoritesPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "filter-favorites.json");
}

/**
 * The stored favourites, in their stored order — the row's order is the user's, so
 * nothing here sorts.
 *
 * Anything unreadable answers an empty list rather than throwing: a corrupt or
 * hand-mangled file must cost the board its favourites row, never the board. The
 * parse goes through the same `validateFavorites` the endpoint uses, which is what
 * keeps a hand-edited file held to the same rules as a PUT — and, the useful half,
 * normalizes each search through the url codec so an invented parameter cannot reach
 * the address bar. It is all-or-nothing by design (see validateFavorites): one bad
 * entry answers empty, where dropping it would leave a row that silently lost a
 * favourite the user would then re-create.
 *
 * Cached in-process, as readOverrides is and for the same reason — the single Next
 * process makes it safe — and invalidated by writeFavorites and by the test reset.
 */
export function readFavorites(): FilterFavorite[] {
  if (cache) return cache;
  let value: FilterFavorite[] = [];
  try {
    const parsed = validateFavorites(JSON.parse(readFileSync(favoritesPath(), "utf8")));
    if (parsed.ok) value = parsed.value;
  } catch {
    // No file, or not JSON at all. Either way: no favourites.
  }
  cache = value;
  return cache;
}

/** Replace the stored list. Validated by the caller — the route's 422 is the guard. */
export function writeFavorites(next: FilterFavorite[]): void {
  const path = favoritesPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  cache = next;
}

export function _resetFilterFavoritesCache(): void {
  cache = undefined;
}
