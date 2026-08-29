import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so the spy has to be hoisted with it.
const { setIssueStatus } = vi.hoisted(() => ({ setIssueStatus: vi.fn(async () => {}) }));
vi.mock("@/server/linear", () => ({ setIssueStatus }));

import { POST } from "@/app/api/tickets/[id]/status/route";

const TOKEN = "test-token";
function req(body?: unknown, auth = true): Request {
  return new Request("http://localhost/api/tickets/RIC-275/status", {
    method: "POST",
    headers: auth ? { "x-mojito-token": TOKEN, "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id = "RIC-275") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  setIssueStatus.mockClear();
  setIssueStatus.mockImplementation(async () => {});
});

describe("/api/tickets/[id]/status", () => {
  it("401 without a token", async () => {
    expect((await POST(req({ status: "Todo" }, false), params())).status).toBe(401);
    expect(setIssueStatus).not.toHaveBeenCalled();
  });

  it("400 on an invalid ticket identifier", async () => {
    expect((await POST(req({ status: "Todo" }), params("nope"))).status).toBe(400);
    expect(setIssueStatus).not.toHaveBeenCalled();
  });

  it("400 on a non-JSON body", async () => {
    const bad = new Request("http://localhost/api/tickets/RIC-275/status", {
      method: "POST",
      headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" },
      body: "{",
    });
    expect((await POST(bad, params())).status).toBe(400);
    expect(setIssueStatus).not.toHaveBeenCalled();
  });

  // This endpoint is the manual Backlog<->Todo move and nothing else: every other
  // transition belongs to a launch or a QA verdict, which own their own preconditions.
  // An open `status` here would be a way to write Done over unmerged work.
  it("400 on a status outside the manual pair", async () => {
    for (const status of ["In Progress", "To QA", "Done", "Canceled", "", "Backlog "]) {
      expect((await POST(req({ status }), params())).status, `status ${status}`).toBe(400);
    }
    expect((await POST(req({ status: 1 }), params())).status).toBe(400);
    expect((await POST(req({}), params())).status).toBe(400);
    expect(setIssueStatus).not.toHaveBeenCalled();
  });

  it("moves the ticket both ways, passing the target through", async () => {
    const toTodo = await POST(req({ status: "Todo" }), params());
    expect(toTodo.status).toBe(200);
    expect(await toTodo.json()).toEqual({ ok: true, status: "Todo" });
    expect(setIssueStatus).toHaveBeenCalledWith("k", "RIC-275", "Todo");

    const toBacklog = await POST(req({ status: "Backlog" }), params());
    expect(toBacklog.status).toBe(200);
    expect(setIssueStatus).toHaveBeenLastCalledWith("k", "RIC-275", "Backlog");
  });

  it("502 when Linear fails", async () => {
    setIssueStatus.mockImplementation(async () => { throw new Error("boom"); });
    expect((await POST(req({ status: "Todo" }), params())).status).toBe(502);
  });
});
