import { filterSearch, parseFilters, type ListFilters } from "./appLocation";
import { narrowed } from "./filterMemory";

/**
 * A named filter set, as the quick-access bar shows it (RIC-306).
 *
 * `search` is the *query string the address bar itself writes* — `filterSearch`'s
 * output, no leading `?` — and not a copy of the six `ListFilters` fields. Two things
 * fall out of that. The format cannot drift from the url's, since a favourite is read
 * back by the same `parseFilters` that reads a hand-typed url (the argument
 * filterMemory already rests on, and the reason both formats live in appLocation). And
 * "which favourite is the board showing?" becomes one canonical string compare rather
 * than a six-field deep-equal that a new filter would silently fall out of.
 */
export interface FilterFavorite {
  name: string;
  search: string;
}

/**
 * How long a name may be. It has to fit a chip on a 320px phone, where the row is the
 * one control that must stay readable at a glance; longer names are truncated rather
 * than refused, since a name is a label and losing its tail costs nothing.
 */
export const MAX_NAME = 40;

/**
 * How many favourites the bar holds. A bound the *file* needs more than the user does:
 * the row scrolls horizontally, but a runaway client must not be able to grow a config
 * file without limit. Well past what anyone curates by hand.
 */
export const MAX_FAVORITES = 24;

/** Trimmed and clipped to MAX_NAME. `""` means "not a usable name". */
function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME);
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function indexOfName(list: FilterFavorite[], name: string): number {
  return list.findIndex((f) => sameName(f.name, name));
}

/** The stored search, re-written the one way `filterSearch` writes it. */
function canonical(search: string): string {
  return filterSearch(parseFilters(search));
}

/**
 * The list with this filter set saved under this name, or the list unchanged when the
 * save is not worth making.
 *
 * Three refusals, each of them a state the bar should not be able to reach:
 *
 * - a blank name, which would put an unlabelled chip in the row;
 * - a filter set that deviates from nothing, because the board it restores is the one
 *   "Clear all" already gets you to in a single tap — the same `narrowed` predicate
 *   filterMemory uses to decide a set is worth remembering, and it says yes to a board
 *   whose only deviation is *showing* the Backlog (RIC-275), which narrows nothing but
 *   is very much a set worth naming;
 * - one past the cap, and only for a *new* name: replacing an existing favourite in a
 *   full list keeps the length where it is, so the cap never blocks a re-save.
 *
 * A name that already exists is replaced in place rather than appended, so re-saving
 * over a favourite keeps its position in the row — the position is the user's since
 * RIC-306 gave the row arrows. The name already stored wins over the one just typed,
 * because a case-insensitive match means the user meant *that* favourite and re-typing
 * it differently is not a rename (renameFavorite is).
 */
export function addFavorite(
  list: FilterFavorite[], name: string, filters: ListFilters,
): FilterFavorite[] {
  const clean = cleanName(name);
  if (clean === "" || !narrowed(filters)) return list;
  const search = filterSearch(filters);
  const at = indexOfName(list, clean);
  if (at !== -1) return list.map((f, i) => (i === at ? { name: f.name, search } : f));
  if (list.length >= MAX_FAVORITES) return list;
  return [...list, { name: clean, search }];
}

/**
 * Why this save cannot be made, as a sentence to show under the name field, or `null`
 * when it can.
 *
 * The companion to addFavorite, which answers the *list* and so can only say "refused"
 * by handing back what it was given — a silence the row would have to render as
 * nothing happening. Kept out of addFavorite itself so the rule stays one pure
 * predicate per question, and out of the component so the wording is testable without
 * a DOM (the usual split).
 *
 * A name already taken is deliberately not a refusal: that save replaces the favourite
 * in place, which is how you update one to the filters now on screen.
 */
export function addRefusal(
  list: FilterFavorite[], name: string, filters: ListFilters,
): string | null {
  if (cleanName(name) === "") return "Give the favourite a name.";
  if (!narrowed(filters)) return "Set some filters to save first.";
  if (indexOfName(list, cleanName(name)) === -1 && list.length >= MAX_FAVORITES) {
    return `You can keep up to ${MAX_FAVORITES} favourites.`;
  }
  return null;
}

/**
 * Why this rename cannot be made, or `null` when it can — renameFavorite's companion,
 * for the same reason addRefusal is addFavorite's.
 *
 * The collision message names the favourite standing in the way, because that one is
 * somewhere else in the row and its name may differ in case from what was just typed:
 * "Mojito already has that name" is actionable where "name taken" sends the user
 * hunting.
 */
export function renameRefusal(
  list: FilterFavorite[], from: string, to: string,
): string | null {
  const clean = cleanName(to);
  if (clean === "") return "Give the favourite a name.";
  const at = indexOfName(list, from);
  const clash = list.find((f, i) => i !== at && sameName(f.name, clean));
  return clash ? `${clash.name} already has that name.` : null;
}

/** The filters a favourite stands for. */
export function favoriteFilters({ search }: FilterFavorite): ListFilters {
  return parseFilters(search);
}

/**
 * Which favourite the board is currently showing, or `null` for none of them.
 *
 * Both sides go through `filterSearch` rather than comparing the stored string as it
 * lies: a hand-edited config file can hold the same set with its parameters in another
 * order, and a favourite you are demonstrably looking at must still light up.
 */
export function activeFavorite(list: FilterFavorite[], filters: ListFilters): string | null {
  const current = filterSearch(filters);
  return list.find((f) => canonical(f.search) === current)?.name ?? null;
}

/**
 * The list with one favourite renamed, or `null` when the rename cannot be made — a
 * blank name, a name another favourite already holds, or a favourite that is no longer
 * there. `null` rather than the unchanged list so the caller can tell "nothing to do"
 * from "refused" and leave the input open with what was typed still in it.
 *
 * A collision is refused rather than merged: two favourites carry two filter sets, and
 * silently dropping one of them loses work the user cannot get back. Re-capitalising a
 * favourite's *own* name is not a collision, which is what makes fixing a typo in the
 * case possible at all.
 */
export function renameFavorite(
  list: FilterFavorite[], from: string, to: string,
): FilterFavorite[] | null {
  const clean = cleanName(to);
  if (clean === "") return null;
  const at = indexOfName(list, from);
  if (at === -1) return null;
  if (list.some((f, i) => i !== at && sameName(f.name, clean))) return null;
  return list.map((f, i) => (i === at ? { name: clean, search: f.search } : f));
}

/**
 * The list with one favourite moved a single place — `-1` towards the start, `1`
 * towards the end.
 *
 * Clamped at both ends rather than wrapping: the row's arrows are held down to walk a
 * favourite along it, and a wrap would send it back where it started without the user
 * having asked for anything of the sort. An unknown name is a no-op for the same
 * reason a stale filter chip is (see removeFilter): the list may have moved on under a
 * tap.
 */
export function moveFavorite(
  list: FilterFavorite[], name: string, delta: -1 | 1,
): FilterFavorite[] {
  const at = indexOfName(list, name);
  if (at === -1) return list;
  const to = at + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The list without that favourite. Order is the user's, so the rest keep theirs. */
export function removeFavorite(list: FilterFavorite[], name: string): FilterFavorite[] {
  return list.filter((f) => !sameName(f.name, name));
}

/**
 * The endpoint's guard over whatever a client — or a hand-edited config file — sends.
 *
 * Rejecting rather than repairing, with the two exceptions the client itself already
 * applies (a name is trimmed and clipped, a search is re-canonicalized): a favourite is
 * a whole named thing, so dropping the bad ones would leave the user with a row that
 * silently lost an entry, where a 422 says what happened. The normalization is the
 * load-bearing half — it runs every stored search through the url codec, so a
 * parameter appLocation does not own (`doc`, `docProject`, anything invented) cannot
 * ride into a saved favourite and back out into the address bar.
 */
export function validateFavorites(
  x: unknown,
): { ok: true; value: FilterFavorite[] } | { ok: false; error: string } {
  if (!Array.isArray(x)) return { ok: false, error: "not an array" };
  if (x.length > MAX_FAVORITES) return { ok: false, error: `more than ${MAX_FAVORITES} favourites` };
  const value: FilterFavorite[] = [];
  for (const entry of x) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "entry is not an object" };
    }
    const { name, search } = entry as { name?: unknown; search?: unknown };
    if (typeof name !== "string" || typeof search !== "string") {
      return { ok: false, error: "entry needs a name and a search" };
    }
    const clean = cleanName(name);
    if (clean === "") return { ok: false, error: "blank name" };
    if (value.some((f) => sameName(f.name, clean))) {
      return { ok: false, error: `two favourites named ${clean}` };
    }
    if (!narrowed(parseFilters(search))) {
      return { ok: false, error: `favourite ${clean} filters nothing` };
    }
    value.push({ name: clean, search: canonical(search) });
  }
  return { ok: true, value };
}
