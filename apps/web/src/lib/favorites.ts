import type { Favorite } from "@mojito/shared";

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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

/** Index of the favourite whose search is `search`; `-1` for none. The bare board is never a favourite. */
export function activeFavorite(list: Favorite[], search: string): number {
  if (search === "") return -1;
  return list.findIndex((f) => f.search === search);
}
