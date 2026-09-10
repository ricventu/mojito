import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  repoRootFromWorktree: vi.fn(async (_cwd: string): Promise<string | null> => null),
  currentBranch: vi.fn(async (_cwd: string) => ""),
  registryGet: vi.fn((_id: string) => undefined as unknown),
}));

vi.mock("@/server/merge", () => ({ repoRootFromWorktree: h.repoRootFromWorktree }));
vi.mock("@/server/projectStack", () => ({ currentBranch: h.currentBranch }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", stateDir: "/state", port: 4711 }),
  getRegistry: () => ({ get: h.registryGet }),
}));

import { GET } from "@/app/api/sessions/[id]/repo-info/route";

const TOKEN = "test-token";
function req(auth = true): Request {
  return new Request("http://localhost/api/sessions/mojito-RIC-46-work/repo-info", {
    method: "GET",
    headers: auth ? { "x-mojito-token": TOKEN } : {},
  });
}
const params = (id = "mojito-RIC-46-work") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.registryGet.mockImplementation(() => undefined);
  h.repoRootFromWorktree.mockImplementation(async (_cwd: string): Promise<string | null> => null);
  h.currentBranch.mockImplementation(async (_cwd: string) => "");
});

describe("GET /api/sessions/[id]/repo-info", () => {
  it("401 without a token", async () => {
    const res = await GET(req(false), params());
    expect(res.status).toBe(401);
  });

  it("404 for an unknown session", async () => {
    const res = await GET(req(), params("mojito-ghost"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown session" });
  });

  it("returns empty fields when the session has no cwd", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "" }));
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repoRoot: "", branch: "", isRepoRoot: false });
  });

  it("returns empty fields when cwd is not inside a git repo", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/tmp/no-git-here" }));
    // repoRootFromWorktree returns null (not a git repo), currentBranch throws
    h.repoRootFromWorktree.mockImplementation(async () => null);
    h.currentBranch.mockImplementation(async () => { throw new Error("not a git repo"); });

    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repoRoot: "", branch: "", isRepoRoot: false });
  });

  it("returns the repo root and branch when cwd is the repo root", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito" }));
    h.repoRootFromWorktree.mockImplementation(async () => "/code/mojito");
    h.currentBranch.mockImplementation(async () => "main");

    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repoRoot: "/code/mojito",
      branch: "main",
      isRepoRoot: true,
    });
  });

  it("returns the repo root and branch when cwd is a worktree", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito/.claude/worktrees/RIC-46" }));
    h.repoRootFromWorktree.mockImplementation(async () => "/code/mojito");
    h.currentBranch.mockImplementation(async () => "ric-46-work");

    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repoRoot: "/code/mojito",
      branch: "ric-46-work",
      isRepoRoot: false,
    });
  });

  it("returns empty branch when on a detached HEAD", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito" }));
    h.repoRootFromWorktree.mockImplementation(async () => "/code/mojito");
    h.currentBranch.mockImplementation(async () => { throw new Error("detached HEAD"); });

    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      repoRoot: "/code/mojito",
      branch: "",
      isRepoRoot: true,
    });
  });

  it("still returns the repo root when currentBranch throws but repoRootFromWorktree succeeds", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito" }));
    h.repoRootFromWorktree.mockImplementation(async () => "/code/mojito");
    h.currentBranch.mockImplementation(async () => { throw new Error("git failed"); });

    const res = await GET(req(), params());
    const body = await res.json();
    expect(body.repoRoot).toBe("/code/mojito");
    expect(body.isRepoRoot).toBe(true);
    expect(body.branch).toBe("");
  });

  it("still returns the branch when repoRootFromWorktree throws", async () => {
    h.registryGet.mockImplementation(() => ({ cwd: "/code/mojito" }));
    h.repoRootFromWorktree.mockImplementation(async () => { throw new Error("git failed"); });
    h.currentBranch.mockImplementation(async () => "main");

    const res = await GET(req(), params());
    const body = await res.json();
    expect(body.repoRoot).toBe("");
    expect(body.isRepoRoot).toBe(false);
    expect(body.branch).toBe("main");
  });
});
