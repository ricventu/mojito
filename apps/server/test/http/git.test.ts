import { describe, expect, it, vi } from "vitest";
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
