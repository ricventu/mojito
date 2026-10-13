import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/server/gitTarget", () => {
  const deps = { session: () => undefined, projectsPath: "/p.json", currentBranch: () => null };
  return { resolveGitTarget: vi.fn(), gitTargetDeps: vi.fn(() => deps) };
});
// Keep the real isValidHash: the route's validation is part of what is under test.
vi.mock("@/server/gitGraph", async (orig) => ({
  ...(await orig<typeof import("@/server/gitGraph")>()),
  readGitGraph: vi.fn(),
  readCommit: vi.fn(),
}));

import { GET as GRAPH } from "@/app/api/git/graph/route";
import { GET as COMMIT } from "@/app/api/git/commit/route";
import { resolveGitTarget } from "@/server/gitTarget";
import { readCommit, readGitGraph } from "@/server/gitGraph";

const TOKEN = "test-token";
const req = (path: string, auth = true) =>
  new Request(`http://localhost${path}`, { headers: auth ? { "x-mojito-token": TOKEN } : {} });
const okTarget = { ok: true as const, cwd: "/repo", label: "Mojito", highlight: null };
const empty = { head: null, highlight: null, commits: [], hasMore: false };

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  vi.mocked(resolveGitTarget).mockReset();
  vi.mocked(readGitGraph).mockReset();
  vi.mocked(readCommit).mockReset();
});

describe("GET /api/git/graph", () => {
  it("401s without the token", async () => {
    expect((await GRAPH(req("/api/git/graph?project=Mojito", false))).status).toBe(401);
  });

  it("answers the target's error code", async () => {
    vi.mocked(resolveGitTarget).mockReturnValue({ ok: false, error: "unknown project", code: 404 });
    const res = await GRAPH(req("/api/git/graph?project=Nope"));
    expect(res.status).toBe(404);
    expect(readGitGraph).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "abc", "1e3"])("400s skip=%s", async (skip) => {
    vi.mocked(resolveGitTarget).mockReturnValue(okTarget);
    expect((await GRAPH(req(`/api/git/graph?project=Mojito&skip=${skip}`))).status).toBe(400);
    expect(readGitGraph).not.toHaveBeenCalled();
  });

  it("reads the page at skip, with the target's highlight, and labels it", async () => {
    vi.mocked(resolveGitTarget).mockReturnValue({ ...okTarget, highlight: "RIC-1-x" });
    vi.mocked(readGitGraph).mockResolvedValue(empty);
    const res = await GRAPH(req("/api/git/graph?project=Mojito&skip=200"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ label: "Mojito", ...empty });
    expect(readGitGraph).toHaveBeenCalledWith("/repo", { skip: 200, highlight: "RIC-1-x" });
  });

  it("409s a git failure with git's words", async () => {
    vi.mocked(resolveGitTarget).mockReturnValue(okTarget);
    vi.mocked(readGitGraph).mockRejectedValue(Object.assign(new Error("x"), { stderr: "fatal: not a git repository" }));
    const res = await GRAPH(req("/api/git/graph?project=Mojito"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "fatal: not a git repository" });
  });
});

describe("GET /api/git/commit", () => {
  it("400s an invalid hash before resolving anything", async () => {
    const res = await COMMIT(req("/api/git/commit?project=Mojito&hash=--output%3D%2Ftmp%2Fx"));
    expect(res.status).toBe(400);
    expect(resolveGitTarget).not.toHaveBeenCalled();
    expect(readCommit).not.toHaveBeenCalled();
  });

  it("404s a commit the repo does not have", async () => {
    vi.mocked(resolveGitTarget).mockReturnValue(okTarget);
    vi.mocked(readCommit).mockResolvedValue(null);
    expect((await COMMIT(req("/api/git/commit?project=Mojito&hash=abc1234"))).status).toBe(404);
  });

  it("answers the details", async () => {
    vi.mocked(resolveGitTarget).mockReturnValue(okTarget);
    const d = { hash: "a".repeat(40), parents: [], author: "A", email: "a@x", date: "", message: "m", files: [], moreFiles: 0 };
    vi.mocked(readCommit).mockResolvedValue(d);
    const res = await COMMIT(req("/api/git/commit?project=Mojito&hash=aaaaaaa"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(d);
    expect(readCommit).toHaveBeenCalledWith("/repo", "aaaaaaa");
  });
});
