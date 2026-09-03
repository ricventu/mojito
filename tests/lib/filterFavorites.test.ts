import { describe, it, expect } from "vitest";
import { NO_FILTERS, parseFilters, type ListFilters } from "@/lib/appLocation";
import {
  MAX_FAVORITES, MAX_NAME,
  activeFavorite, addFavorite, addRefusal, favoriteFilters, moveFavorite, removeFavorite,
  renameFavorite, renameRefusal, validateFavorites, type FilterFavorite,
} from "@/lib/filterFavorites";

const mojito: ListFilters = { ...NO_FILTERS, project: ["Mojito"] };
const mine: ListFilters = { ...NO_FILTERS, mine: true, sessionsOnly: true };

function fav(name: string, search: string): FilterFavorite {
  return { name, search };
}

describe("addFavorite", () => {
  it("stores the filters as the query string the address bar uses", () => {
    expect(addFavorite([], "Mojito", mojito)).toEqual([fav("Mojito", "project=Mojito")]);
  });

  it("trims the name", () => {
    expect(addFavorite([], "  Mojito  ", mojito)[0].name).toBe("Mojito");
  });

  it("appends to the end, so the row keeps the order they were saved in", () => {
    const first = addFavorite([], "Mojito", mojito);
    expect(addFavorite(first, "Mine", mine).map((f) => f.name)).toEqual(["Mojito", "Mine"]);
  });

  it("replaces a favourite of the same name in place rather than duplicating it", () => {
    const list = addFavorite(addFavorite([], "Mojito", mojito), "Mine", mine);
    const next = addFavorite(list, "Mojito", mine);
    expect(next.map((f) => f.name)).toEqual(["Mojito", "Mine"]);
    expect(next[0].search).toBe("mine=1&sessions=1");
  });

  it("matches an existing name case-insensitively, keeping the name already stored", () => {
    const next = addFavorite(addFavorite([], "Mojito", mojito), "MOJITO", mine);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("Mojito");
  });

  it("refuses a blank name, leaving the list alone", () => {
    expect(addFavorite([], "   ", mojito)).toEqual([]);
  });

  it("refuses filters that narrow nothing — the default board is not worth a chip", () => {
    expect(addFavorite([], "Everything", NO_FILTERS)).toEqual([]);
  });

  it("saves a board whose only deviation is showing the Backlog", () => {
    const shown: ListFilters = { ...NO_FILTERS, backlog: true };
    expect(addFavorite([], "With backlog", shown)).toEqual([fav("With backlog", "backlog=1")]);
  });

  it("refuses to grow past the cap", () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => fav(`f${i}`, "mine=1"));
    expect(addFavorite(full, "one more", mojito)).toEqual(full);
  });

  it("still replaces by name once the list is full", () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => fav(`f${i}`, "mine=1"));
    const next = addFavorite(full, "f0", mojito);
    expect(next).toHaveLength(MAX_FAVORITES);
    expect(next[0].search).toBe("project=Mojito");
  });

  it("truncates an over-long name rather than refusing it", () => {
    const name = "x".repeat(MAX_NAME + 10);
    expect(addFavorite([], name, mojito)[0].name).toBe("x".repeat(MAX_NAME));
  });
});

describe("favoriteFilters", () => {
  it("reads the stored search back through the url parser", () => {
    expect(favoriteFilters(fav("Mine", "mine=1&sessions=1"))).toEqual(mine);
  });

  it("round-trips every filter, the Backlog flag included", () => {
    const all: ListFilters = {
      query: "auth bug", project: ["Mojito", "Fornace"], status: "To QA",
      mine: true, sessionsOnly: true, backlog: true,
    };
    expect(favoriteFilters(addFavorite([], "All", all)[0])).toEqual(all);
  });
});

describe("activeFavorite", () => {
  const list = [fav("Mojito", "project=Mojito"), fav("Mine", "mine=1&sessions=1")];

  it("names the favourite whose filters the board is showing", () => {
    expect(activeFavorite(list, mine)).toBe("Mine");
  });

  it("is null when the board matches none of them", () => {
    expect(activeFavorite(list, NO_FILTERS)).toBe(null);
  });

  it("ignores the order the parameters happen to be written in", () => {
    expect(activeFavorite([fav("Mine", "sessions=1&mine=1")], mine)).toBe("Mine");
  });

  it("does not match a favourite that is only a subset of the board's filters", () => {
    expect(activeFavorite(list, { ...mojito, mine: true })).toBe(null);
  });
});

describe("renameFavorite", () => {
  const list = [fav("Mojito", "project=Mojito"), fav("Mine", "mine=1")];

  it("renames in place, keeping the position and the filters", () => {
    expect(renameFavorite(list, "Mojito", "Mojito work")).toEqual([
      fav("Mojito work", "project=Mojito"), fav("Mine", "mine=1"),
    ]);
  });

  it("trims and truncates the new name like addFavorite does", () => {
    expect(renameFavorite(list, "Mine", "  Just mine  ")![1].name).toBe("Just mine");
    expect(renameFavorite(list, "Mine", "y".repeat(MAX_NAME + 5))![1].name).toBe("y".repeat(MAX_NAME));
  });

  it("refuses a blank name", () => {
    expect(renameFavorite(list, "Mine", "  ")).toBe(null);
  });

  it("refuses a name another favourite already has, rather than merging the two", () => {
    expect(renameFavorite(list, "Mine", "Mojito")).toBe(null);
    expect(renameFavorite(list, "Mine", "mojito")).toBe(null);
  });

  it("allows a rename that only changes the capitalisation of its own name", () => {
    expect(renameFavorite(list, "Mine", "MINE")![1].name).toBe("MINE");
  });

  it("answers null for a favourite that is no longer there", () => {
    expect(renameFavorite(list, "Gone", "Something")).toBe(null);
  });
});

describe("moveFavorite", () => {
  const list = [fav("a", "mine=1"), fav("b", "mine=1"), fav("c", "mine=1")];
  const names = (l: FilterFavorite[]) => l.map((f) => f.name);

  it("moves one place towards the start", () => {
    expect(names(moveFavorite(list, "c", -1))).toEqual(["a", "c", "b"]);
  });

  it("moves one place towards the end", () => {
    expect(names(moveFavorite(list, "a", 1))).toEqual(["b", "a", "c"]);
  });

  it("clamps at the start rather than wrapping to the end", () => {
    expect(names(moveFavorite(list, "a", -1))).toEqual(["a", "b", "c"]);
  });

  it("clamps at the end rather than wrapping to the start", () => {
    expect(names(moveFavorite(list, "c", 1))).toEqual(["a", "b", "c"]);
  });

  it("leaves the list alone for a name it does not hold", () => {
    expect(names(moveFavorite(list, "gone", 1))).toEqual(["a", "b", "c"]);
  });
});

describe("removeFavorite", () => {
  it("drops just that one, keeping the order of the rest", () => {
    const list = [fav("a", "mine=1"), fav("b", "mine=1"), fav("c", "mine=1")];
    expect(removeFavorite(list, "b").map((f) => f.name)).toEqual(["a", "c"]);
  });

  it("matches the name case-insensitively", () => {
    expect(removeFavorite([fav("Mine", "mine=1")], "mine")).toEqual([]);
  });
});

describe("validateFavorites", () => {
  it("accepts a well-formed list, in the order given", () => {
    const value = [fav("Mine", "mine=1"), fav("Mojito", "project=Mojito")];
    expect(validateFavorites(value)).toEqual({ ok: true, value });
  });

  it("accepts an empty list", () => {
    expect(validateFavorites([])).toEqual({ ok: true, value: [] });
  });

  it("rejects anything that is not an array", () => {
    expect(validateFavorites({}).ok).toBe(false);
    expect(validateFavorites(null).ok).toBe(false);
  });

  it("rejects an entry that is not an object with two strings", () => {
    expect(validateFavorites([{ name: "Mine" }]).ok).toBe(false);
    expect(validateFavorites([{ name: 1, search: "mine=1" }]).ok).toBe(false);
    expect(validateFavorites(["Mine"]).ok).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(validateFavorites([fav("  ", "mine=1")]).ok).toBe(false);
  });

  it("rejects a list longer than the cap", () => {
    const many = Array.from({ length: MAX_FAVORITES + 1 }, (_, i) => fav(`f${i}`, "mine=1"));
    expect(validateFavorites(many).ok).toBe(false);
  });

  it("rejects two favourites sharing a name", () => {
    expect(validateFavorites([fav("Mine", "mine=1"), fav("mine", "sessions=1")]).ok).toBe(false);
  });

  it("trims and truncates names it accepts", () => {
    const long = "z".repeat(MAX_NAME + 3);
    const res = validateFavorites([fav(`  ${long}  `, "mine=1")]);
    expect(res.ok && res.value[0].name).toBe("z".repeat(MAX_NAME));
  });

  it("normalizes the search through the url codec, dropping parameters it does not own", () => {
    const res = validateFavorites([fav("Odd", "mine=1&doc=README.md&nonsense=1")]);
    expect(res.ok && res.value[0].search).toBe("mine=1");
  });

  it("rejects a favourite whose filters narrow nothing once normalized", () => {
    expect(validateFavorites([fav("Empty", "nonsense=1")]).ok).toBe(false);
  });

  it("keeps a hand-written search a parser would reorder canonical", () => {
    const res = validateFavorites([fav("Mine", "sessions=1&mine=1")]);
    expect(res.ok && res.value[0].search).toBe("mine=1&sessions=1");
    expect(res.ok && parseFilters(res.value[0].search)).toEqual(mine);
  });
});

describe("addRefusal", () => {
  it("is silent when the save can be made", () => {
    expect(addRefusal([], "Mojito", mojito)).toBe(null);
  });

  it("is silent for a name already taken — that save replaces it", () => {
    expect(addRefusal(addFavorite([], "Mojito", mojito), "Mojito", mine)).toBe(null);
  });

  it("names the blank-name case", () => {
    expect(addRefusal([], "  ", mojito)).toMatch(/name/i);
  });

  it("names the nothing-to-save case", () => {
    expect(addRefusal([], "Everything", NO_FILTERS)).toMatch(/filter/i);
  });

  it("names the cap, and only for a new favourite", () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => fav(`f${i}`, "mine=1"));
    expect(addRefusal(full, "one more", mojito)).toContain(String(MAX_FAVORITES));
    expect(addRefusal(full, "f0", mojito)).toBe(null);
  });
});

describe("renameRefusal", () => {
  const list = [fav("Mojito", "project=Mojito"), fav("Mine", "mine=1")];

  it("is silent when the rename can be made", () => {
    expect(renameRefusal(list, "Mine", "Just mine")).toBe(null);
  });

  it("is silent for a rename that only changes its own capitalisation", () => {
    expect(renameRefusal(list, "Mine", "MINE")).toBe(null);
  });

  it("names the blank-name case", () => {
    expect(renameRefusal(list, "Mine", " ")).toMatch(/name/i);
  });

  it("says which favourite already holds the name", () => {
    expect(renameRefusal(list, "Mine", "mojito")).toContain("Mojito");
  });
});
