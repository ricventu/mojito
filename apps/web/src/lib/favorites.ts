import type { Favorite } from "@mojito/shared";
import { canonicalSearch, parseFilters, type BoardFilters } from "@/lib/filters";

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The server's limit on a favourite's name. */
const NAME_MAX = 60;

/** `text` cut to `max` characters, the last one an ellipsis when cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The name a favourite gets unless the human types one: its filters in the url's canonical
 * order (so every device derives the same name from the same search), joined by " · ".
 * More than two projects are counted, not listed. "" for the bare board.
 */
export function favoriteName(f: BoardFilters): string {
  const { projects, statuses, live, q } = parseFilters(new URLSearchParams(canonicalSearch(f)));
  const parts = [
    ...(projects.length > 2 ? [`${projects.length} projects`] : projects),
    ...statuses,
    ...(live ? ["Active"] : []),
    ...(q !== "" ? [`"${q}"`] : []),
  ];
  return clip(parts.join(" · "), NAME_MAX);
}

/** The automatic name of a stored search. */
const searchName = (search: string) => favoriteName(parseFilters(new URLSearchParams(search)));

/**
 * `name`, or `name 2`, `name 3`… when another entry (any but `except`) already has it in any
 * case; clipped so the numbered name still fits.
 */
export function uniqueName(list: Favorite[], name: string, except = -1): string {
  const taken = (n: string) => list.some((f, i) => i !== except && sameName(f.name, n));
  if (!taken(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = clip(name, NAME_MAX - suffix.length) + suffix;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * Gives entry `index` the filters `search`, in place. A favourite still named after its old
 * filters (its automatic name) is renamed after the new ones; a name the human chose is kept.
 * An equal search or an index out of range returns `list` itself.
 */
export function updateFavorite(list: Favorite[], index: number, search: string): Favorite[] {
  const entry = list[index];
  if (entry === undefined || entry.search === search) return list;
  const name = entry.name === searchName(entry.search) ? uniqueName(list, searchName(search), index) : entry.name;
  return list.map((f, i) => (i === index ? { name, search } : f));
}

/**
 * Saves a favourite at the end. A name already in the list (case-insensitive) updates that
 * entry's `search` instead, keeping its stored name and position. A blank name changes nothing.
 */
export function addFavorite(
  list: Favorite[],
  name: string,
  search: string,
): { list: Favorite[]; replaced: boolean } {
  const trimmed = name.trim();
  if (trimmed === "") return { list, replaced: false };
  const at = list.findIndex((f) => sameName(f.name, trimmed));
  if (at === -1) return { list: [...list, { name: trimmed, search }], replaced: false };
  return { list: list.map((f, i) => (i === at ? { ...f, search } : f)), replaced: true };
}

/** Why `name` cannot be the new name of entry `index`, or `null` when it can. */
export function renameRefusal(list: Favorite[], index: number, name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Name required";
  if (list.some((f, i) => i !== index && sameName(f.name, trimmed))) {
    return "A favourite with this name already exists";
  }
  return null;
}

/** Index of the favourite named `name` in any case; `-1` for none. */
export function favoriteIndex(list: Favorite[], name: string): number {
  return list.findIndex((f) => sameName(f.name, name));
}

/** Callers check `renameRefusal` first; a refused name returns the list unchanged. */
export function renameFavorite(list: Favorite[], index: number, name: string): Favorite[] {
  if (renameRefusal(list, index, name) !== null) return list;
  return list.map((f, i) => (i === index ? { ...f, name: name.trim() } : f));
}

/** Swaps the entry with its neighbour; at either end, or out of range, nothing moves. */
export function moveFavorite(list: Favorite[], index: number, delta: -1 | 1): Favorite[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function removeFavorite(list: Favorite[], index: number): Favorite[] {
  return list.filter((_, i) => i !== index);
}

/**
 * Index of the favourite whose search is `search` (a `canonicalSearch`); `-1` for none. The
 * stored one is re-canonicalised, so one saved in another order still matches. The bare
 * board is never a favourite.
 */
export function activeFavorite(list: Favorite[], search: string): number {
  if (search === "") return -1;
  return list.findIndex((f) => canonicalSearch(parseFilters(new URLSearchParams(f.search))) === search);
}

/**
 * The list to show and to compute the next write from: the newest queued write (its PUT may
 * not have landed yet), else the cached settings. A refetch landing mid-queue therefore
 * never shows an older list or becomes the base of the next write. `undefined` while
 * settings have never loaded: a write then would replace the server's list with a guess.
 */
export function currentFavorites(cached: Favorite[] | undefined, queued: Favorite[][]): Favorite[] | undefined {
  return queued.length > 0 ? queued[queued.length - 1] : cached;
}
