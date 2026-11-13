import { describe, expect, it, vi } from "vitest";
import type { DirList } from "@mojito/shared";
import type { DirListResult } from "../../src/fs/dirs";
import { setup } from "./setup";

const list: DirList = { path: "/home/me", parent: "/home", home: "/home/me", dirs: [{ name: "code", git: false }] };

function withLister(result: DirListResult = { ok: true, list }) {
  const listDirs = vi.fn(async (_path: string) => result);
  return { ...setup({ listDirs }), listDirs };
}

describe("GET /api/fs/dirs", () => {
  it("lists HOME when no path is given", async () => {
    const ctx = withLister();
    for (const url of ["/api/fs/dirs", "/api/fs/dirs?path="]) {
      const res = await ctx.req(url);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(list);
      expect(ctx.listDirs).toHaveBeenLastCalledWith("/home/me");
    }
  });

  it.each([
    ["~", "/home/me"],
    ["~/code/", "/home/me/code"],
    ["/a/b/../c", "/a/c"],
  ])("expands and normalises %s", async (typed, expected) => {
    const ctx = withLister();
    const res = await ctx.req(`/api/fs/dirs?path=${encodeURIComponent(typed)}`);
    expect(res.status).toBe(200);
    expect(ctx.listDirs).toHaveBeenCalledWith(expected);
  });

  it("refuses a relative path or a NUL without listing", async () => {
    const ctx = withLister();
    let res = await ctx.req("/api/fs/dirs?path=code");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "path must be absolute: code" });
    res = await ctx.req("/api/fs/dirs?path=%2Fa%00b");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid path" });
    expect(ctx.listDirs).not.toHaveBeenCalled();
  });

  it("404s a missing folder, 403s an unreadable one", async () => {
    let ctx = withLister({ ok: false, reason: "not-found" });
    let res = await ctx.req("/api/fs/dirs?path=/x");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "folder not found: /x" });
    ctx = withLister({ ok: false, reason: "forbidden" });
    res = await ctx.req("/api/fs/dirs?path=/x");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "folder not readable: /x" });
  });

  it("needs the token", async () => {
    const ctx = withLister();
    const res = await ctx.app.request("/api/fs/dirs");
    expect(res.status).toBe(401);
    expect(ctx.listDirs).not.toHaveBeenCalled();
  });

  it("answers 504 when the folder does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const ctx = { ...setup({ listDirs: () => new Promise<DirListResult>(() => {}) }) };
      const pending = ctx.req("/api/fs/dirs?path=/mnt");
      await vi.advanceTimersByTimeAsync(10_000);
      const res = await pending;
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ error: "folder did not answer within 10 s: /mnt" });
    } finally {
      vi.useRealTimers();
    }
  });
});
