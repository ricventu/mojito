import { describe, expect, it, vi } from "vitest";
import { LinearClient } from "../../src/linear/client";

type Call = { url: string; init: RequestInit; body: { query: string; variables?: Record<string, unknown> } };

/** A fetch that answers each call with the next payload and records what was sent. */
function seq(payloads: unknown[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok: true, status: 200, json: async () => ({ data: payloads[i++] }) } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("LinearClient.listOpenIssues", () => {
  const node = {
    identifier: "RIC-46",
    title: "Do thing",
    url: "https://linear.app/acme/issue/RIC-46/do-thing",
    state: { name: "In Progress", type: "started" },
    project: { name: "Web" },
    labels: { nodes: [{ name: "bug" }] },
    assignee: { isMe: true },
  };

  it("scopes by project through a variable and maps nodes onto TicketSummary", async () => {
    const { fetchImpl, calls } = seq([{ issues: { nodes: [node] } }]);
    const items = await new LinearClient("key", fetchImpl).listOpenIssues(["Web"]);
    expect(calls[0].body.variables).toEqual({ projects: ["Web"] });
    expect(calls[0].body.query).toContain("$projects: [String!]!");
    expect(calls[0].body.query).not.toContain('"Web"');
    expect(calls[0].init.headers).toMatchObject({ Authorization: "key" });
    expect(items).toEqual([
      {
        identifier: "RIC-46",
        title: "Do thing",
        url: "https://linear.app/acme/issue/RIC-46/do-thing",
        statusName: "In Progress",
        statusType: "started",
        project: "Web",
        labels: ["bug"],
        assignedToMe: true,
      },
    ]);
  });

  it("declares no variables and does not filter by project for an empty list", async () => {
    const { fetchImpl, calls } = seq([{ issues: { nodes: [] } }]);
    await new LinearClient("key", fetchImpl).listOpenIssues([]);
    expect(calls[0].body.variables).toBeUndefined();
    expect(calls[0].body.query).not.toContain("$projects");
    expect(calls[0].body.query).not.toContain("project:");
  });

  it("defaults missing fields and sorts by project then identifier", async () => {
    const { fetchImpl } = seq([
      {
        issues: {
          nodes: [
            { identifier: "B-2", project: { name: "Z" } },
            { identifier: "B-1", project: { name: "Z" } },
            { identifier: "A-1", project: { name: "A" } },
            {},
          ],
        },
      },
    ]);
    const items = await new LinearClient("key", fetchImpl).listOpenIssues([]);
    expect(items.map((i) => i.identifier)).toEqual(["", "A-1", "B-1", "B-2"]);
    expect(items[0]).toEqual({
      identifier: "",
      title: "",
      url: "",
      statusName: "",
      statusType: "",
      project: null,
      labels: [],
      assignedToMe: false,
    });
  });
});

describe("LinearClient errors", () => {
  it("HTTP 500 throws Linear API error: 500", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    await expect(new LinearClient("k", fetchImpl).listOpenIssues([])).rejects.toThrow("Linear API error: 500");
  });

  it("a response carrying errors throws Linear GraphQL error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "nope" }] }),
    }) as Response) as unknown as typeof fetch;
    await expect(new LinearClient("k", fetchImpl).listOpenIssues([])).rejects.toThrow("Linear GraphQL error");
  });
});

// A hung connection must not stall the board poll, a launch or a task slot for good.
describe("LinearClient timeouts", () => {
  /** A fetch that never answers, and rejects with the signal's reason once it aborts. */
  const hanging = () =>
    vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;

  it("gives every request a deadline", async () => {
    const { fetchImpl, calls } = seq([{ issues: { nodes: [] } }]);
    await new LinearClient("k", fetchImpl).listOpenIssues([]);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a request that never answers into an error like the others", async () => {
    await expect(new LinearClient("k", hanging(), 20).listOpenIssues([])).rejects.toThrow(
      "Linear API timeout after 20 ms",
    );
  });

  it("bounds the upload PUT too", async () => {
    let n = 0;
    const put = hanging();
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (++n === 1)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { fileUpload: { success: true, uploadFile: { uploadUrl: "u", assetUrl: "a", headers: [] } } },
          }),
        } as Response;
      return put(url, init);
    }) as unknown as typeof fetch;
    await expect(
      new LinearClient("k", fetchImpl, 20).uploadImage({ filename: "a.png", contentType: "image/png", size: 1, bytes: new Uint8Array([1]) }),
    ).rejects.toThrow("Linear API timeout after 20 ms");
  });
});

describe("LinearClient.setStatus", () => {
  const ref = { issues: { nodes: [{ id: "I1", team: { id: "T1" } }] } };

  it("resolves the state by name and writes it", async () => {
    const { fetchImpl, calls } = seq([
      ref,
      { team: { states: { nodes: [{ id: "S1", name: "Todo" }, { id: "S2", name: "In Review" }] } } },
      { issueUpdate: { success: true } },
    ]);
    await new LinearClient("k", fetchImpl).setStatus("RIC-9", "In Review");
    expect(calls[0].body.variables).toEqual({ key: "RIC", n: 9 });
    expect(calls[2].body.variables).toEqual({ id: "I1", stateId: "S2" });
  });

  it("throws on a state the team does not have", async () => {
    const { fetchImpl } = seq([ref, { team: { states: { nodes: [{ id: "S1", name: "Todo" }] } } }]);
    await expect(new LinearClient("k", fetchImpl).setStatus("RIC-9", "Foo")).rejects.toThrow(
      'workflow state "Foo" not found in team',
    );
  });

  it("throws on an unknown issue and on a malformed identifier", async () => {
    const { fetchImpl } = seq([{ issues: { nodes: [] } }]);
    const client = new LinearClient("k", fetchImpl);
    await expect(client.setStatus("RIC-9", "Todo")).rejects.toThrow("issue not found: RIC-9");
    await expect(client.setStatus("nope", "Todo")).rejects.toThrow("invalid ticket id: nope");
  });
});

describe("LinearClient.assignToMe", () => {
  it("assigns to the viewer", async () => {
    const { fetchImpl, calls } = seq([
      { issues: { nodes: [{ id: "I1", team: { id: "T1" } }] } },
      { viewer: { id: "U1" } },
      { issueUpdate: { success: true } },
    ]);
    await new LinearClient("k", fetchImpl).assignToMe("RIC-9");
    expect(calls[2].body.variables).toEqual({ id: "I1", assigneeId: "U1" });
  });
});

describe("LinearClient.uploadImage", () => {
  it("requests an upload slot, PUTs the bytes with its headers and returns the asset url", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              fileUpload: {
                success: true,
                uploadFile: {
                  uploadUrl: "https://storage.example/put",
                  assetUrl: "https://uploads.linear.app/a.png",
                  headers: [{ key: "x-amz", value: "1" }],
                },
              },
            },
          }),
        } as Response;
      }
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const bytes = new Uint8Array([1, 2, 3]);
    const url = await new LinearClient("k", fetchImpl).uploadImage({
      filename: "a.png",
      contentType: "image/png",
      size: 3,
      bytes,
    });
    expect(url).toBe("https://uploads.linear.app/a.png");
    expect(JSON.parse(String(calls[0].init?.body)).variables).toEqual({
      size: 3,
      contentType: "image/png",
      filename: "a.png",
    });
    expect(calls[1].url).toBe("https://storage.example/put");
    expect(calls[1].init?.method).toBe("PUT");
    expect(calls[1].init?.headers).toEqual({ "Content-Type": "image/png", "x-amz": "1" });
    expect(calls[1].init?.body).toBe(bytes);
  });

  it("throws when the PUT fails", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { fileUpload: { success: true, uploadFile: { uploadUrl: "u", assetUrl: "a", headers: [] } } },
          }),
        } as Response;
      return { ok: false, status: 403 } as Response;
    }) as unknown as typeof fetch;
    await expect(
      new LinearClient("k", fetchImpl).uploadImage({ filename: "a", contentType: "image/png", size: 1, bytes: new Uint8Array(1) }),
    ).rejects.toThrow("Linear asset upload failed: 403");
  });
});

describe("LinearClient.listTeamStates / listLabels", () => {
  it("lists state names ordered by position", async () => {
    const { fetchImpl, calls } = seq([
      {
        teams: {
          nodes: [
            {
              states: {
                nodes: [
                  { name: "Done", position: 3 },
                  { name: "Backlog", position: 0 },
                  { name: "Todo", position: 1 },
                ],
              },
            },
          ],
        },
      },
    ]);
    const names = await new LinearClient("k", fetchImpl).listTeamStates("RIC");
    expect(names).toEqual(["Backlog", "Todo", "Done"]);
    expect(calls[0].body.variables).toEqual({ key: "RIC" });
  });

  it("throws for an unknown team", async () => {
    const { fetchImpl } = seq([{ teams: { nodes: [] } }]);
    await expect(new LinearClient("k", fetchImpl).listTeamStates("XX")).rejects.toThrow("team not found: XX");
  });

  it("lists team and workspace labels through issueLabels, dropping retired ones", async () => {
    const { fetchImpl, calls } = seq([
      {
        issueLabels: {
          nodes: [
            { id: "L1", name: "Bug", retiredAt: null },
            { id: "L2", name: "Old", retiredAt: "2026-01-01T00:00:00Z" },
            { id: "L3", name: "Feature" },
          ],
        },
      },
    ]);
    expect(await new LinearClient("k", fetchImpl).listLabels("RIC")).toEqual([
      { id: "L1", name: "Bug" },
      { id: "L3", name: "Feature" },
    ]);
    const q = calls[0].body.query.replace(/\s+/g, " ");
    expect(q).toContain("issueLabels(");
    expect(q).toContain("or: [{ team: { key: { eq: $key } } }, { team: { null: true } }]");
    expect(q).not.toContain("retiredAt: {");
    expect(q).toContain("nodes { id name retiredAt }");
    expect(calls[0].body.variables).toEqual({ key: "RIC" });
  });
});

describe("LinearClient.createIssue", () => {
  const team = { teams: { nodes: [{ id: "T1", projects: { nodes: [{ id: "P1" }] } }] } };
  const created = { issueCreate: { success: true, issue: { identifier: "RIC-300", url: "https://linear.app/x/RIC-300" } } };
  const input = { teamKey: "RIC", project: "Web", title: "T", description: "D" };

  it("resolves team and project then sends labelIds when a label is given", async () => {
    const { fetchImpl, calls } = seq([team, created]);
    const res = await new LinearClient("k", fetchImpl).createIssue({ ...input, labelId: "L1" });
    expect(res).toEqual({ identifier: "RIC-300", url: "https://linear.app/x/RIC-300" });
    expect(calls[0].body.variables).toEqual({ key: "RIC", name: "Web" });
    expect(calls[1].body.query).toContain("issueCreate");
    expect(calls[1].body.variables).toEqual({
      input: { teamId: "T1", projectId: "P1", title: "T", description: "D", labelIds: ["L1"] },
    });
  });

  it("omits labelIds without a label", async () => {
    const { fetchImpl, calls } = seq([team, created]);
    await new LinearClient("k", fetchImpl).createIssue(input);
    const sent = (calls[1].body.variables as { input: Record<string, unknown> }).input;
    expect(sent).not.toHaveProperty("labelIds");
  });

  it("throws when the project is not in the team", async () => {
    const { fetchImpl } = seq([{ teams: { nodes: [{ id: "T1", projects: { nodes: [] } }] } }]);
    await expect(new LinearClient("k", fetchImpl).createIssue(input)).rejects.toThrow(
      'project "Web" not found in team RIC',
    );
  });

  it("throws when the team is not found or issueCreate fails", async () => {
    await expect(
      new LinearClient("k", seq([{ teams: { nodes: [] } }]).fetchImpl).createIssue(input),
    ).rejects.toThrow("team not found: RIC");
    await expect(
      new LinearClient("k", seq([team, { issueCreate: { success: false } }]).fetchImpl).createIssue(input),
    ).rejects.toThrow("Linear issueCreate failed");
  });
});
