import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so the spies have to be hoisted with it.
const { listOpenIssues } = vi.hoisted(() => ({ listOpenIssues: vi.fn(async () => [] as unknown[]) }));
vi.mock("@/server/linear", () => ({ listOpenIssues, uploadImage: vi.fn() }));

import { GET } from "@/app/api/tickets/route";

const TOKEN = "test-token";
const req = (auth = true) =>
  new Request("http://localhost/api/tickets", { headers: auth ? { "x-mojito-token": TOKEN } : {} });

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  listOpenIssues.mockReset();
  listOpenIssues.mockImplementation(async () => []);
});

describe("GET /api/tickets", () => {
  it("401 without a token", async () => {
    expect((await GET(req(false))).status).toBe(401);
    expect(listOpenIssues).not.toHaveBeenCalled();
  });

  it("answers the issues", async () => {
    listOpenIssues.mockImplementation(async () => [{ identifier: "RIC-1" }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ identifier: "RIC-1" }]);
  });

  // The board renders this body straight (useTickets → apiError → the notice banner),
  // so a plain-text 502 put the bare status code in front of the user instead of a
  // reason. Every other route here answers JSON; this one used not to.
  it("502s as JSON with a reason when Linear fails", async () => {
    listOpenIssues.mockImplementation(async () => { throw new Error("boom"); });
    const res = await GET(req());
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect((await res.json()).error).toBe("Linear is not answering");
  });
});
