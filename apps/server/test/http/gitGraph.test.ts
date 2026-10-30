import { describe, expect, it, vi } from "vitest";
import type { CommitDetails, CommitDiff, GitGraphPage } from "@mojito/shared";
import { GitError } from "../../src/git/git";
import { setup } from "./setup";

const web = { name: "Web", path: "~/repo/web", teamKey: "RIC" };
const HASH = "a".repeat(40);
const page: GitGraphPage = { head: HASH, highlight: null, commits: [], hasMore: false };
const details: CommitDetails = {
  hash: HASH,
  parents: [],
  author: "Me",
  email: "me@x.io",
  date: "2026-10-30T10:00:00+00:00",
  message: "init",
  files: [{ status: "A", path: "a.txt" }],
  moreFiles: 0,
};
const diff: CommitDiff = { patch: "@@ -0,0 +1 @@\n+a\n", binary: false, truncated: false };

function withReader(over: Partial<Record<"graph" | "commit" | "diff", (...a: never[]) => Promise<unknown>>> = {}) {
  const gitRead = {
    graph: vi.fn(async (_cwd: string, _opts: { skip: number; ticket: string | null }) => page),
    commit: vi.fn(async (_cwd: string, _hash: string): Promise<CommitDetails | null> => details),
    diff: vi.fn(async (_cwd: string, _hash: string, _path: string, _from: string | null): Promise<CommitDiff | null> => diff),
    ...over,
  };
  const ctx = setup({ gitRead: gitRead as never });
  ctx.projects.upsert(web);
  return { ...ctx, gitRead };
}

const base = "/api/projects/Web/git";

describe("GET /api/projects/:name/git/graph", () => {
  it("reads the graph in the expanded checkout, with skip and ticket", async () => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/graph?skip=200&ticket=RIC-5`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(page);
    expect(ctx.gitRead.graph).toHaveBeenCalledWith("/home/me/repo/web", { skip: 200, ticket: "RIC-5" });
  });

  it("defaults skip to 0 and ticket to null", async () => {
    const ctx = withReader();
    await ctx.req(`${base}/graph`);
    expect(ctx.gitRead.graph).toHaveBeenCalledWith("/home/me/repo/web", { skip: 0, ticket: null });
  });

  it.each(["skip=-1", "skip=x", "skip=", "skip=1.5", "ticket=../x", "ticket="])("refuses %s without calling git", async (q) => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/graph?${q}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
    expect(ctx.gitRead.graph).not.toHaveBeenCalled();
  });

  it("404s an unknown project", async () => {
    const ctx = withReader();
    const res = await ctx.req("/api/projects/Nope/git/graph");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project not found: Nope" });
    expect(ctx.gitRead.graph).not.toHaveBeenCalled();
  });

  it("400s a project path missing on disk", async () => {
    const ctx = withReader();
    ctx.exists.mockReturnValue(false);
    const res = await ctx.req(`${base}/graph`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "project path not found: /home/me/repo/web" });
    expect(ctx.gitRead.graph).not.toHaveBeenCalled();
  });

  it("answers git's own message as a 409", async () => {
    const ctx = withReader({
      graph: async () => {
        throw new GitError(["for-each-ref"], "fatal: not a git repository\n", 128);
      },
    });
    const res = await ctx.req(`${base}/graph`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "fatal: not a git repository" });
  });

  it("cuts git's message at 500 characters, and falls back to the error's own when it is empty", async () => {
    const long = withReader({
      graph: async () => {
        throw new GitError(["log"], "x".repeat(900));
      },
    });
    expect(((await (await long.req(`${base}/graph`)).json()) as { error: string }).error).toHaveLength(500);
    const empty = withReader({
      graph: async () => {
        throw new GitError(["log"], "  ");
      },
    });
    expect(await (await empty.req(`${base}/graph`)).json()).toEqual({ error: "git log failed: no output" });
  });

  it("lets any other error be a 500", async () => {
    const ctx = withReader({
      graph: async () => {
        throw new Error("boom");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await ctx.req(`${base}/graph`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("is behind the token", async () => {
    const ctx = withReader();
    const res = await ctx.app.request(`${base}/graph`);
    expect(res.status).toBe(401);
    expect(ctx.gitRead.graph).not.toHaveBeenCalled();
  });
});

describe("GET /api/projects/:name/git/commits/:hash", () => {
  it("answers the commit's details", async () => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/commits/${HASH}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(details);
    expect(ctx.gitRead.commit).toHaveBeenCalledWith("/home/me/repo/web", HASH);
  });

  it("404s a hash that is no commit", async () => {
    const ctx = withReader({ commit: async () => null });
    const res = await ctx.req(`${base}/commits/${HASH}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "commit not found" });
  });

  it.each(["HEAD~1", "abc12", "ABCDEF1", "g".repeat(7), "a".repeat(41)])("400s the hash %s without calling git", async (hash) => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/commits/${encodeURIComponent(hash)}`);
    expect(res.status).toBe(400);
    expect(ctx.gitRead.commit).not.toHaveBeenCalled();
  });

  it("answers git's message as a 409", async () => {
    const ctx = withReader({
      commit: async () => {
        throw new GitError(["show"], "fatal: bad object", 128);
      },
    });
    const res = await ctx.req(`${base}/commits/${HASH}`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "fatal: bad object" });
  });

  it("404s an unknown project and is behind the token", async () => {
    const ctx = withReader();
    expect((await ctx.req(`/api/projects/Nope/git/commits/${HASH}`)).status).toBe(404);
    expect((await ctx.app.request(`${base}/commits/${HASH}`)).status).toBe(401);
  });
});

describe("GET /api/projects/:name/git/commits/:hash/diff", () => {
  it("answers one file's diff, with `from` when given", async () => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/commits/${HASH}/diff?path=${encodeURIComponent("src/a b.ts")}&from=old.ts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(diff);
    expect(ctx.gitRead.diff).toHaveBeenCalledWith("/home/me/repo/web", HASH, "src/a b.ts", "old.ts");
  });

  it("passes null for an absent or empty `from`", async () => {
    const ctx = withReader();
    await ctx.req(`${base}/commits/${HASH}/diff?path=a.txt`);
    await ctx.req(`${base}/commits/${HASH}/diff?path=a.txt&from=`);
    expect(ctx.gitRead.diff).toHaveBeenNthCalledWith(1, "/home/me/repo/web", HASH, "a.txt", null);
    expect(ctx.gitRead.diff).toHaveBeenNthCalledWith(2, "/home/me/repo/web", HASH, "a.txt", null);
  });

  it.each(["", "?path=", "?from=a.txt"])("400s a missing or empty path (%s) without calling git", async (q) => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/commits/${HASH}/diff${q}`);
    expect(res.status).toBe(400);
    expect(ctx.gitRead.diff).not.toHaveBeenCalled();
  });

  it.each(["?path=a%00b", "?path=a.txt&from=b%00c"])("400s a NUL in path or from (%s) without calling git", async (q) => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/commits/${HASH}/diff${q}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "path contains a NUL byte" });
    expect(ctx.gitRead.diff).not.toHaveBeenCalled();
  });

  it("400s a bad hash", async () => {
    const ctx = withReader();
    const res = await ctx.req(`${base}/commits/HEAD/diff?path=a.txt`);
    expect(res.status).toBe(400);
    expect(ctx.gitRead.diff).not.toHaveBeenCalled();
  });

  it("404s a hash that is no commit", async () => {
    const ctx = withReader({ diff: async () => null });
    const res = await ctx.req(`${base}/commits/${HASH}/diff?path=a.txt`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "commit not found" });
  });

  it("answers git's message as a 409 and is behind the token", async () => {
    const ctx = withReader({
      diff: async () => {
        throw new GitError(["show"], "fatal: boom", 128);
      },
    });
    const res = await ctx.req(`${base}/commits/${HASH}/diff?path=a.txt`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "fatal: boom" });
    expect((await ctx.app.request(`${base}/commits/${HASH}/diff?path=a.txt`)).status).toBe(401);
  });
});
