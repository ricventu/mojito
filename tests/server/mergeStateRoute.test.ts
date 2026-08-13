import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ hasNothingToMerge: vi.fn(async () => true) }));

vi.mock("@/server/ticketMergeState", () => ({ hasNothingToMerge: h.hasNothingToMerge }));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "t", projectsPath: "/cfg/projects.json" }),
}));
vi.mock("@/server/auth", () => ({
  tokenFromHeaders: (h: Headers, t: string) => h.get("authorization") === `Bearer ${t}`,
}));

import { GET } from "@/app/api/tickets/[id]/merge-state/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs = "?projectName=mojito") =>
  new Request(`http://localhost/api/tickets/RIC-110/merge-state${qs}`, { headers: { authorization: "Bearer t" } });

beforeEach(() => {
  h.hasNothingToMerge.mockClear();
  h.hasNothingToMerge.mockResolvedValue(true);
});

describe("GET /api/tickets/[id]/merge-state", () => {
  it("answers the check, passing the project through", async () => {
    const res = await GET(req(), params("RIC-110"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nothingToMerge: true });
    expect(h.hasNothingToMerge).toHaveBeenCalledWith("/cfg/projects.json", "RIC-110", "mojito");
  });

  it("passes a null project when the query string omits it", async () => {
    await GET(req(""), params("RIC-110"));
    expect(h.hasNothingToMerge).toHaveBeenCalledWith("/cfg/projects.json", "RIC-110", null);
  });

  it("reports a mergeable branch", async () => {
    h.hasNothingToMerge.mockResolvedValue(false);
    expect(await (await GET(req(), params("RIC-110"))).json()).toEqual({ nothingToMerge: false });
  });

  it("401s without a token", async () => {
    const bare = new Request("http://localhost/api/tickets/RIC-110/merge-state");
    expect((await GET(bare, params("RIC-110"))).status).toBe(401);
  });

  it("400s an invalid ticket id", async () => {
    expect((await GET(req(), params("nope"))).status).toBe(400);
  });
});
