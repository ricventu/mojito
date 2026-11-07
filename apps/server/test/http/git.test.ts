import { describe, expect, it, vi } from "vitest";
import { GitError } from "../../src/git/git";
import type { PullOutcome, PushOutcome } from "../../src/git/sync";
import { SyncError } from "../../src/git/sync";
import { meta, setup } from "./setup";

const web = { name: "Web", path: "~/repo/web", teamKey: "RIC" };
const conflict = { status: "conflict" as const, branch: "main", upstream: "origin/main", reason: "conflicts in a.txt" };

function withGit(pull: () => Promise<PullOutcome>, push: () => Promise<PushOutcome> = async () => ({ status: "up-to-date", branch: "main" })) {
  const git = { pull: vi.fn(async (_cwd: string) => pull()), push: vi.fn(async (_cwd: string) => push()) };
  const ctx = setup({ git });
  ctx.projects.upsert(web);
  return { ...ctx, git };
}

const post = (ctx: ReturnType<typeof setup>, op: string, project = "Web") =>
  ctx.req(`/api/projects/${encodeURIComponent(project)}/${op}`, { method: "POST" });

describe("POST /api/projects/:name/pull|push", () => {
  it("pulls in the project's checkout, with ~ expanded", async () => {
    const ctx = withGit(async () => ({ status: "updated", branch: "main", from: "aaa", to: "bbb", commits: 2 }));
    const res = await post(ctx, "pull");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "updated", branch: "main", from: "aaa", to: "bbb", commits: 2 });
    expect(ctx.git.pull).toHaveBeenCalledWith("/home/me/repo/web");
  });

  it("pushes", async () => {
    const ctx = withGit(
      async () => ({ status: "up-to-date", branch: "main" }),
      async () => ({ status: "pushed", branch: "main", commits: 1, pulled: 0 }),
    );
    const res = await post(ctx, "push");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pushed", branch: "main", commits: 1, pulled: 0 });
  });

  it("opens the git session on a conflict and answers it", async () => {
    const ctx = withGit(async () => conflict);
    const res = await post(ctx, "pull");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; alreadyOpen: boolean; session: { id: string } };
    expect(body).toMatchObject({ status: "conflict", alreadyOpen: false, session: { id: "mj-web-git", project: "Web" } });
    expect(ctx.launch.newSession).toHaveBeenCalledWith("mj-web-git", "/home/me/repo/web", expect.stringContaining("Pull of branch main"));
  });

  it("answers the git session already open rather than a second one", async () => {
    const ctx = withGit(async () => conflict, async () => conflict);
    const live = meta({ id: "mj-web-git", kind: "claude", ticket: null, state: "idle" });
    ctx.sessions.insert(live);
    const res = await post(ctx, "push");
    expect(await res.json()).toEqual({ status: "conflict", alreadyOpen: true, session: live });
    expect(ctx.launch.newSession).not.toHaveBeenCalled();
  });

  it("answers git's own message when the operation fails", async () => {
    const ctx = withGit(async () => {
      throw new SyncError("main has no upstream: push it first");
    });
    const res = await post(ctx, "pull");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "main has no upstream: push it first" });
  });

  it("refuses a second operation on the same project while one runs", async () => {
    let release: (() => void) | undefined;
    const upToDate = { status: "up-to-date" as const, branch: "main" };
    const ctx = withGit(() =>
      release ? Promise.resolve(upToDate) : new Promise((resolve) => (release = () => resolve(upToDate))),
    );
    const first = post(ctx, "pull");
    await vi.waitFor(() => expect(ctx.git.pull).toHaveBeenCalled());
    const second = await post(ctx, "push");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "a pull is already running on Web" });
    release!();
    expect((await first).status).toBe(200);
    expect((await post(ctx, "pull")).status).toBe(200);
  });

  it("404s an unknown project and an unknown operation", async () => {
    const ctx = withGit(async () => ({ status: "up-to-date", branch: "main" }));
    expect((await post(ctx, "pull", "Nope")).status).toBe(404);
    expect((await post(ctx, "fetch")).status).toBe(404);
  });

  it("refuses a project whose path is gone", async () => {
    const ctx = withGit(async () => ({ status: "up-to-date", branch: "main" }));
    ctx.exists.mockReturnValue(false);
    const res = await post(ctx, "pull");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "project path not found: /home/me/repo/web" });
    expect(ctx.git.pull).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/:name/clean", () => {
  it("opens the project's clean session and answers it", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    const res = await post(ctx, "clean");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ alreadyOpen: false, session: { id: "mj-web-clean", project: "Web" } });
    expect(ctx.launch.newSession).toHaveBeenCalledWith("mj-web-clean", "/home/me/repo/web", expect.stringContaining("fetch --prune"));
  });

  it("answers the clean session already open", async () => {
    const ctx = setup();
    ctx.projects.upsert(web);
    const live = meta({ id: "mj-web-clean", kind: "claude", ticket: null, state: "idle" });
    ctx.sessions.insert(live);
    expect(await (await post(ctx, "clean")).json()).toEqual({ alreadyOpen: true, session: live });
  });

  it("404s an unknown project", async () => {
    const ctx = setup();
    const res = await post(ctx, "clean", "Nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project not found: Nope" });
  });
});

describe("GET /api/projects/:name/worktrees", () => {
  it("counts the linked worktrees of the project's checkout", async () => {
    const worktrees = vi.fn(async (_cwd: string) => 3);
    const ctx = setup({ worktrees });
    ctx.projects.upsert(web);
    const res = await ctx.req("/api/projects/Web/worktrees");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3 });
    expect(worktrees).toHaveBeenCalledWith("/home/me/repo/web");
  });

  it("answers git's words with a 409 when it cannot list them", async () => {
    const ctx = setup({
      worktrees: async () => {
        throw new GitError(["worktree"], "fatal: not a git repository", 128);
      },
    });
    ctx.projects.upsert(web);
    const res = await ctx.req("/api/projects/Web/worktrees");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "git worktree failed: fatal: not a git repository" });
  });

  it("404s an unknown project and 400s a missing path", async () => {
    const ctx = setup({ worktrees: async () => 0 });
    expect((await ctx.req("/api/projects/Nope/worktrees")).status).toBe(404);
    ctx.projects.upsert(web);
    ctx.exists.mockReturnValue(false);
    expect((await ctx.req("/api/projects/Web/worktrees")).status).toBe(400);
  });
});
