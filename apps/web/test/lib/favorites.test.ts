import { describe, expect, it } from "vitest";
import type { Favorite } from "@mojito/shared";
import {
  activeFavorite,
  addFavorite,
  moveFavorite,
  removeFavorite,
  renameFavorite,
  renameRefusal,
} from "@/lib/favorites";

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

  it("is -1 for no match and for the bare board", () => {
    expect(activeFavorite([A, M], "q=nope")).toBe(-1);
    expect(activeFavorite([{ name: "Empty", search: "" }], "")).toBe(-1);
  });
});
