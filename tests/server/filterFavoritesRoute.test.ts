import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "@/app/api/config/filter-favorites/route";
import { _resetFilterFavoritesCache, readFavorites } from "@/server/filterFavorites";
import { MAX_FAVORITES } from "@/lib/filterFavorites";

const TOKEN = "test-token";
function req(method: string, body?: unknown, auth = true): Request {
  return new Request("http://localhost/api/config/filter-favorites", {
    method,
    headers: auth ? { "x-mojito-token": TOKEN, "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  _resetFilterFavoritesCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/config/filter-favorites", () => {
  it("401 without a token", async () => {
    expect((await GET(req("GET", undefined, false))).status).toBe(401);
  });

  it("answers an empty list before anything is saved", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ favorites: [] });
  });

  it("answers what a PUT stored", async () => {
    await PUT(req("PUT", { favorites: [{ name: "Mine", search: "mine=1" }] }));
    expect(await (await GET(req("GET"))).json())
      .toEqual({ favorites: [{ name: "Mine", search: "mine=1" }] });
  });
});

describe("PUT /api/config/filter-favorites", () => {
  it("401 without a token", async () => {
    const res = await PUT(req("PUT", { favorites: [] }, false));
    expect(res.status).toBe(401);
  });

  it("400 on a body that is not JSON", async () => {
    const res = await PUT(new Request("http://localhost/api/config/filter-favorites", {
      method: "PUT",
      headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" },
      body: "{ not json",
    }));
    expect(res.status).toBe(400);
  });

  it("stores the list and answers it back", async () => {
    const favorites = [{ name: "Mine", search: "mine=1" }, { name: "Mojito", search: "project=Mojito" }];
    const res = await PUT(req("PUT", { favorites }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ favorites });
    expect(readFavorites()).toEqual(favorites);
  });

  it("keeps the order it was given — reordering is a PUT of the whole list", async () => {
    await PUT(req("PUT", { favorites: [{ name: "a", search: "mine=1" }, { name: "b", search: "sessions=1" }] }));
    await PUT(req("PUT", { favorites: [{ name: "b", search: "sessions=1" }, { name: "a", search: "mine=1" }] }));
    expect(readFavorites().map((f) => f.name)).toEqual(["b", "a"]);
  });

  it("422 on a list the guard refuses, leaving what was stored alone", async () => {
    const good = [{ name: "Mine", search: "mine=1" }];
    await PUT(req("PUT", { favorites: good }));
    const res = await PUT(req("PUT", { favorites: [{ name: "  ", search: "mine=1" }] }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBeTruthy();
    expect(readFavorites()).toEqual(good);
  });

  it("422 when the body carries no favourites array at all", async () => {
    expect((await PUT(req("PUT", {}))).status).toBe(422);
  });

  it("422 past the cap", async () => {
    const many = Array.from({ length: MAX_FAVORITES + 1 }, (_, i) => ({ name: `f${i}`, search: "mine=1" }));
    expect((await PUT(req("PUT", { favorites: many }))).status).toBe(422);
  });

  it("normalizes what it stores, so an unknown parameter cannot be saved", async () => {
    const res = await PUT(req("PUT", {
      favorites: [{ name: " Mine ", search: "sessions=1&mine=1&doc=README.md" }],
    }));
    expect(await res.json()).toEqual({ favorites: [{ name: "Mine", search: "mine=1&sessions=1" }] });
  });

  it("stores an empty list, which is how the last favourite is deleted", async () => {
    await PUT(req("PUT", { favorites: [{ name: "Mine", search: "mine=1" }] }));
    expect((await PUT(req("PUT", { favorites: [] }))).status).toBe(200);
    expect(readFavorites()).toEqual([]);
  });
});
