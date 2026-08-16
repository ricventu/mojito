import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getTicketWorktreeStatus: vi.fn(async (): Promise<{ exists: boolean; branches: string[]; defaultBranch: string | null }> =>
    ({ exists: true, branches: [], defaultBranch: null })),
}));

vi.mock("@/server/ticketWorktreeStatus", () => ({ getTicketWorktreeStatus: h.getTicketWorktreeStatus }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "t", projectsPath: "/cfg/projects.json" }),
}));
vi.mock("@/server/auth", () => ({
  tokenFromHeaders: (headers: Headers, t: string) => headers.get("authorization") === `Bearer ${t}`,
}));

import { GET } from "@/app/api/tickets/[id]/worktree-status/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs = "?projectName=mojito&title=Some+title") =>
  new Request(`http://localhost/api/tickets/RIC-110/worktree-status${qs}`, { headers: { authorization: "Bearer t" } });

beforeEach(() => {
  h.getTicketWorktreeStatus.mockClear();
  h.getTicketWorktreeStatus.mockResolvedValue({ exists: true, branches: [], defaultBranch: null });
});

describe("GET /api/tickets/[id]/worktree-status", () => {
  it("answers the status, passing project and title through", async () => {
    const res = await GET(req(), params("RIC-110"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: true, branches: [], defaultBranch: null });
    expect(h.getTicketWorktreeStatus).toHaveBeenCalledWith("/cfg/projects.json", "RIC-110", "mojito", "Some title");
  });

  it("passes a null project and empty title when the query string omits them", async () => {
    await GET(req(""), params("RIC-110"));
    expect(h.getTicketWorktreeStatus).toHaveBeenCalledWith("/cfg/projects.json", "RIC-110", null, "");
  });

  it("reports a missing worktree with branches to choose from", async () => {
    h.getTicketWorktreeStatus.mockResolvedValue({ exists: false, branches: ["main", "dev"], defaultBranch: "main" });
    expect(await (await GET(req(), params("RIC-110"))).json()).toEqual({ exists: false, branches: ["main", "dev"], defaultBranch: "main" });
  });

  it("401s without a token", async () => {
    const bare = new Request("http://localhost/api/tickets/RIC-110/worktree-status");
    expect((await GET(bare, params("RIC-110"))).status).toBe(401);
  });

  it("400s an invalid ticket id", async () => {
    expect((await GET(req(), params("nope"))).status).toBe(400);
  });
});
