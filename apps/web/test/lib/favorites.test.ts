import { describe, expect, it } from "vitest";
import type { Favorite } from "@mojito/shared";
import {
  activeFavorite,
  addFavorite,
  currentFavorites,
  favoriteIndex,
  favoriteName,
  moveFavorite,
  removeFavorite,
  renameFavorite,
  renameRefusal,
  uniqueName,
  updateFavorite,
} from "@/lib/favorites";
import { NO_FILTERS, type BoardFilters } from "@/lib/filters";

const A: Favorite = { name: "A", search: "project=a" };
const M: Favorite = { name: "Mojito", search: "project=mojito" };
const C: Favorite = { name: "C", search: "status=Todo" };

describe("addFavorite", () => {
  it("adds at the end, name trimmed", () => {
    const list = [A];
    const r = addFavorite(list, "  Review  ", "status=In%20Review");
    expect(r).toEqual({ list: [A, { name: "Review", search: "status=In%20Review" }], replaced: false });
    expect(list).toEqual([A]);
  });

  it("a same-name save replaces in place, keeping position and stored name", () => {
    const list = [A, M, C];
    const r = addFavorite(list, "mojito", "q=x");
    expect(r.replaced).toBe(true);
    expect(r.list).toEqual([A, { name: "Mojito", search: "q=x" }, C]);
    expect(list[1]).toEqual(M);
  });

  it("matches a same name on the trimmed input", () => {
    expect(addFavorite([M], "  MOJITO ", "q=x").replaced).toBe(true);
  });

  it("a blank name leaves the list unchanged", () => {
    const list = [A];
    expect(addFavorite(list, "   ", "q=x")).toEqual({ list: [A], replaced: false });
  });
});

describe("renameRefusal", () => {
  const list = [A, M, C];

  it("refuses a blank name", () => {
    expect(renameRefusal(list, 0, "")).toBe("Name required");
    expect(renameRefusal(list, 0, "  ")).toBe("Name required");
  });

  it("refuses another entry's name in any case", () => {
    expect(renameRefusal(list, 0, "mojito")).toBe("A favourite with this name already exists");
    expect(renameRefusal(list, 0, " MOJITO ")).toBe("A favourite with this name already exists");
  });

  it("accepts the entry's own name re-capitalised", () => {
    expect(renameRefusal(list, 1, "MOJITO")).toBeNull();
  });

  it("accepts a fresh name", () => {
    expect(renameRefusal(list, 0, "Fresh")).toBeNull();
  });
});

describe("renameFavorite", () => {
  it("trims and keeps search and position", () => {
    const list = [A, M];
    expect(renameFavorite(list, 1, "  Cocktail ")).toEqual([A, { name: "Cocktail", search: M.search }]);
    expect(list[1]).toEqual(M);
  });

  it("returns the list unchanged for a refused name", () => {
    expect(renameFavorite([A, M], 0, "mojito")).toEqual([A, M]);
    expect(renameFavorite([A, M], 0, " ")).toEqual([A, M]);
  });
});

describe("moveFavorite", () => {
  it("swaps up and down", () => {
    const list = [A, M, C];
    expect(moveFavorite(list, 1, -1)).toEqual([M, A, C]);
    expect(moveFavorite(list, 1, 1)).toEqual([A, C, M]);
    expect(list).toEqual([A, M, C]);
  });

  it("the first up and the last down change nothing", () => {
    expect(moveFavorite([A, M, C], 0, -1)).toEqual([A, M, C]);
    expect(moveFavorite([A, M, C], 2, 1)).toEqual([A, M, C]);
  });

  it("an out-of-range index changes nothing", () => {
    expect(moveFavorite([A, M], 5, -1)).toEqual([A, M]);
  });
});

describe("removeFavorite", () => {
  it("removes by index without mutating", () => {
    const list = [A, M, C];
    expect(removeFavorite(list, 1)).toEqual([A, C]);
    expect(list).toEqual([A, M, C]);
  });

  it("an out-of-range index changes nothing", () => {
    expect(removeFavorite([A], 3)).toEqual([A]);
    expect(removeFavorite([A], -1)).toEqual([A]);
  });
});

describe("activeFavorite", () => {
  it("finds the favourite with an equal search", () => {
    expect(activeFavorite([A, M, C], "project=mojito")).toBe(1);
  });

  it("matches a favourite stored in another order", () => {
    // Saved by an older build, or a device that sorted projects differently.
    expect(activeFavorite([{ name: "Both", search: "q=x&project=b&project=a" }], "project=a&project=b&q=x")).toBe(0);
  });

  it("matches a favourite saved before the statuses took the workflow order", () => {
    const old = { name: "Ends", search: "status=In+Review&status=Backlog" };
    expect(activeFavorite([old], "status=Backlog&status=In+Review")).toBe(0);
  });

  it("is -1 for no match and for the bare board", () => {
    expect(activeFavorite([A, M], "q=nope")).toBe(-1);
    expect(activeFavorite([{ name: "Empty", search: "" }], "")).toBe(-1);
  });
});

describe("currentFavorites", () => {
  it("is the cached list when no write is queued", () => {
    const cached = [A, M];
    expect(currentFavorites(cached, [])).toBe(cached);
  });

  it("is the newest queued write, whatever a refetch put in the cache meanwhile", () => {
    const first = [M, A];
    const second = [M, A, C];
    expect(currentFavorites([A, M], [first, second])).toBe(second);
  });

  it("is undefined while settings have never loaded", () => {
    expect(currentFavorites(undefined, [])).toBeUndefined();
  });
});

describe("favoriteIndex", () => {
  it("finds a name in any case, -1 for none", () => {
    expect(favoriteIndex([A, M], "MOJITO")).toBe(1);
    expect(favoriteIndex([A, M], "Gone")).toBe(-1);
  });
});

describe("favoriteName", () => {
  const f = (over: Partial<BoardFilters>): BoardFilters => ({ ...NO_FILTERS, ...over });

  it("joins projects, statuses, Active and the quoted text", () => {
    expect(
      favoriteName(f({ projects: ["Mojito"], statuses: ["Todo", "In Progress"], live: true, q: " login " })),
    ).toBe('Mojito · Todo · In Progress · Active · "login"');
  });

  it("keeps the url's canonical order, whatever order they were picked in", () => {
    expect(favoriteName(f({ projects: ["b", "a"], statuses: ["In Review", "Backlog"] }))).toBe(
      "a · b · Backlog · In Review",
    );
  });

  it("counts more than two projects instead of listing them", () => {
    expect(favoriteName(f({ projects: ["a", "b", "c"], statuses: ["Todo"] }))).toBe("3 projects · Todo");
  });

  it("names a single filter alone", () => {
    expect(favoriteName(f({ live: true }))).toBe("Active");
    expect(favoriteName(f({ q: "x" }))).toBe('"x"');
  });

  it("caps the name at 60 characters with an ellipsis", () => {
    const name = favoriteName(f({ q: "y".repeat(100) }));
    expect(name).toHaveLength(60);
    expect(name.endsWith("…")).toBe(true);
  });

  it("is empty for the bare board", () => {
    expect(favoriteName(NO_FILTERS)).toBe("");
  });
});

describe("uniqueName", () => {
  it("keeps a free name", () => {
    expect(uniqueName([A, M], "Todo")).toBe("Todo");
  });

  it("numbers a taken name, in any case", () => {
    expect(uniqueName([A, M], "mojito")).toBe("mojito 2");
    expect(uniqueName([M, { name: "Mojito 2", search: "q=a" }], "Mojito")).toBe("Mojito 3");
  });

  it("ignores the entry being renamed", () => {
    expect(uniqueName([A, M], "Mojito", 1)).toBe("Mojito");
  });

  it("stays within 60 characters when numbered", () => {
    const long = "z".repeat(60);
    const name = uniqueName([{ name: long, search: "q=z" }], long);
    expect(name).toHaveLength(60);
    expect(name.endsWith("… 2")).toBe(true);
  });
});

describe("updateFavorite", () => {
  it("replaces the search, keeping a name the human chose and the position", () => {
    const list = [A, M, C];
    expect(updateFavorite(list, 1, "project=mojito&status=Todo")).toEqual([
      A,
      { name: "Mojito", search: "project=mojito&status=Todo" },
      C,
    ]);
    expect(list[1]).toEqual(M);
  });

  it("renames a favourite still named after its filters", () => {
    const auto: Favorite = { name: "Mojito · Todo", search: "project=Mojito&status=Todo" };
    expect(updateFavorite([A, auto], 1, "project=Mojito&status=In+Review")).toEqual([
      A,
      { name: "Mojito · In Review", search: "project=Mojito&status=In+Review" },
    ]);
  });

  it("numbers the new automatic name when another favourite has it", () => {
    const auto: Favorite = { name: "Todo", search: "status=Todo" };
    const taken: Favorite = { name: "Backlog", search: "q=b" };
    expect(updateFavorite([taken, auto], 1, "status=Backlog")[1].name).toBe("Backlog 2");
  });

  it("returns the same list for an equal search or a missing index", () => {
    const list = [A, M];
    expect(updateFavorite(list, 0, "project=a")).toBe(list);
    expect(updateFavorite(list, 4, "q=x")).toBe(list);
  });
});
