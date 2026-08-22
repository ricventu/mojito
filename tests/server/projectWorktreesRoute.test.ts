import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getProjectWorktrees: vi.fn((): { worktrees: { path: string; branch: string }[] } => ({ worktrees: [] })),
}));

vi.mock("@/server/projectWorktrees", () => ({ getProjectWorktrees: h.getProjectWorktrees }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "t", projectsPath: "/cfg/projects.json" }),
}));
vi.mock("@/server/auth", () => ({
  tokenFromHeaders: (headers: Headers, t: string) => headers.get("authorization") === `Bearer ${t}`,
}));

import { GET } from "@/app/api/projects/worktrees/route";

const req = (qs = "?projectName=Mojito") =>
  new Request(`http://localhost/api/projects/worktrees${qs}`, { headers: { authorization: "Bearer t" } });

beforeEach(() => {
  h.getProjectWorktrees.mockClear();
  h.getProjectWorktrees.mockReturnValue({ worktrees: [] });
});

describe("GET /api/projects/worktrees", () => {
  it("answers the project's worktrees", async () => {
    h.getProjectWorktrees.mockReturnValue({ worktrees: [{ path: "/repo/wt", branch: "RIC-9-x" }] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ worktrees: [{ path: "/repo/wt", branch: "RIC-9-x" }] });
    expect(h.getProjectWorktrees).toHaveBeenCalledWith("/cfg/projects.json", "Mojito");
  });

  it("passes a null project when the query string omits it", async () => {
    await GET(req(""));
    expect(h.getProjectWorktrees).toHaveBeenCalledWith("/cfg/projects.json", null);
  });

  it("401s without a token", async () => {
    expect((await GET(new Request("http://localhost/api/projects/worktrees"))).status).toBe(401);
  });
});
