import { describe, it, expect, beforeEach, vi } from "vitest";

// vi.mock is hoisted above the imports, so the spy has to be hoisted with it.
const { setIssueAssignee } = vi.hoisted(() => ({ setIssueAssignee: vi.fn(async () => {}) }));
vi.mock("@/server/linear", () => ({ setIssueAssignee }));

import { POST } from "@/app/api/tickets/[id]/assignee/route";

const TOKEN = "test-token";
function req(body?: unknown, auth = true): Request {
  return new Request("http://localhost/api/tickets/RIC-169/assignee", {
    method: "POST",
    headers: auth ? { "x-mojito-token": TOKEN, "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id = "RIC-169") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  setIssueAssignee.mockClear();
  setIssueAssignee.mockImplementation(async () => {});
});

describe("/api/tickets/[id]/assignee", () => {
  it("401 without a token", async () => {
    expect((await POST(req({ mine: true }, false), params())).status).toBe(401);
    expect(setIssueAssignee).not.toHaveBeenCalled();
  });

  it("400 on an invalid ticket identifier", async () => {
    expect((await POST(req({ mine: true }), params("nope"))).status).toBe(400);
    expect(setIssueAssignee).not.toHaveBeenCalled();
  });

  it("400 when mine is not a boolean", async () => {
    expect((await POST(req({ mine: "yes" }), params())).status).toBe(400);
    expect((await POST(req({}), params())).status).toBe(400);
    expect(setIssueAssignee).not.toHaveBeenCalled();
  });

  it("400 on a non-JSON body", async () => {
    const bad = new Request("http://localhost/api/tickets/RIC-169/assignee", {
      method: "POST",
      headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" },
      body: "{",
    });
    expect((await POST(bad, params())).status).toBe(400);
  });

  it("assigns and unassigns, passing the flag through", async () => {
    const assigned = await POST(req({ mine: true }), params());
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toEqual({ ok: true, mine: true });
    expect(setIssueAssignee).toHaveBeenCalledWith("k", "RIC-169", true);

    const cleared = await POST(req({ mine: false }), params());
    expect(cleared.status).toBe(200);
    expect(setIssueAssignee).toHaveBeenLastCalledWith("k", "RIC-169", false);
  });

  it("502 when Linear fails", async () => {
    setIssueAssignee.mockImplementation(async () => { throw new Error("boom"); });
    expect((await POST(req({ mine: true }), params())).status).toBe(502);
  });
});
