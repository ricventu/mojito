import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  favoritesPath, readFavorites, writeFavorites, _resetFilterFavoritesCache,
} from "@/server/filterFavorites";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  _resetFilterFavoritesCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("favoritesPath", () => {
  it("sits beside the other config files, under MOJITO_CONFIG_DIR", () => {
    expect(favoritesPath()).toBe(join(dir, "filter-favorites.json"));
  });
});

describe("readFavorites", () => {
  it("is empty when there is no file", () => {
    expect(readFavorites()).toEqual([]);
  });

  it("reads what writeFavorites wrote", () => {
    writeFavorites([{ name: "Mine", search: "mine=1" }]);
    _resetFilterFavoritesCache();
    expect(readFavorites()).toEqual([{ name: "Mine", search: "mine=1" }]);
  });

  it("keeps the stored order — the row's order is the user's", () => {
    writeFavorites([
      { name: "b", search: "mine=1" },
      { name: "a", search: "sessions=1" },
    ]);
    _resetFilterFavoritesCache();
    expect(readFavorites().map((f) => f.name)).toEqual(["b", "a"]);
  });

  it("is empty for a corrupt file rather than throwing the board down", () => {
    writeFavorites([{ name: "Mine", search: "mine=1" }]);
    writeFileSync(favoritesPath(), "{ not json");
    _resetFilterFavoritesCache();
    expect(readFavorites()).toEqual([]);
  });

  it("is empty for a file that is valid JSON but not a favourites list", () => {
    writeFavorites([]);
    writeFileSync(favoritesPath(), JSON.stringify({ Mine: "mine=1" }));
    _resetFilterFavoritesCache();
    expect(readFavorites()).toEqual([]);
  });

  it("normalizes a hand-edited file through the same guard the endpoint uses", () => {
    writeFavorites([]);
    writeFileSync(favoritesPath(), JSON.stringify([
      { name: "  Mine  ", search: "sessions=1&mine=1&doc=README.md" },
    ]));
    _resetFilterFavoritesCache();
    expect(readFavorites()).toEqual([{ name: "Mine", search: "mine=1&sessions=1" }]);
  });
});

describe("writeFavorites", () => {
  it("creates the config directory when it is not there yet", () => {
    const nested = join(dir, "deeper");
    process.env.MOJITO_CONFIG_DIR = nested;
    _resetFilterFavoritesCache();
    writeFavorites([{ name: "Mine", search: "mine=1" }]);
    expect(JSON.parse(readFileSync(join(nested, "filter-favorites.json"), "utf8")))
      .toEqual([{ name: "Mine", search: "mine=1" }]);
  });

  it("is readable without a re-read, so a PUT can answer from the cache", () => {
    writeFavorites([{ name: "Mine", search: "mine=1" }]);
    expect(readFavorites()).toEqual([{ name: "Mine", search: "mine=1" }]);
  });
});
