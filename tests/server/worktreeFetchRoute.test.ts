import { describe, it, expect, vi, beforeEach } from "vitest";

const ANSWER = {
  status: { exists: false, branches: ["main"], remoteBranches: ["origin/main"], defaultBranch: "main", worktrees: [] },
  warning: null,
};

const h = vi.hoisted(() => ({ fetchTicketRemotes: vi.fn(async (): Promise<unknown> => null) }));

vi.mock("@/server/fetchTicketRemotes", () => ({ fetchTicketRemotes: h.fetchTicketRemotes }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "t", projectsPath: "/cfg/projects.json" }),
}));
vi.mock("@/server/auth", () => ({
  tokenFromHeaders: (headers: Headers, t: string) => headers.get("authorization") === `Bearer ${t}`,
}));

import { POST } from "@/app/api/tickets/[id]/worktree-fetch/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs = "?projectName=mojito&title=Some+title") =>
  new Request(`http://localhost/api/tickets/RIC-110/worktree-fetch${qs}`,
    { method: "POST", headers: { authorization: "Bearer t" } });

beforeEach(() => {
  h.fetchTicketRemotes.mockClear();
  h.fetchTicketRemotes.mockResolvedValue(ANSWER);
});

describe("POST /api/tickets/[id]/worktree-fetch", () => {
  it("answers the refreshed status, passing project and title through", async () => {
    const res = await POST(req(), params("RIC-110"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ANSWER);
    expect(h.fetchTicketRemotes).toHaveBeenCalledWith("/cfg/projects.json", "RIC-110", "mojito", "Some title");
  });

  it("passes a null project and empty title when the query string omits them", async () => {
    await POST(req(""), params("RIC-110"));
    expect(h.fetchTicketRemotes).toHaveBeenCalledWith("/cfg/projects.json", "RIC-110", null, "");
  });

  it("passes a fetch warning through to the client", async () => {
    h.fetchTicketRemotes.mockResolvedValue({ ...ANSWER, warning: "git fetch failed: offline" });
    expect((await (await POST(req(), params("RIC-110"))).json()).warning).toBe("git fetch failed: offline");
  });

  // It writes the repo's refs, so it must not be reachable without the token.
  it("401s without a token", async () => {
    const bare = new Request("http://localhost/api/tickets/RIC-110/worktree-fetch", { method: "POST" });
    expect((await POST(bare, params("RIC-110"))).status).toBe(401);
    expect(h.fetchTicketRemotes).not.toHaveBeenCalled();
  });

  it("400s an invalid ticket id", async () => {
    expect((await POST(req(), params("nope"))).status).toBe(400);
    expect(h.fetchTicketRemotes).not.toHaveBeenCalled();
  });
});
