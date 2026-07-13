import { describe, it, expect, vi } from "vitest";
import { listOpenIssues, getIssueStatus } from "@/server/linear";

function fakeFetch(payload: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ data: payload }) })) as unknown as typeof fetch;
}

describe("linear client", () => {
  it("maps open issues", async () => {
    const f = fakeFetch({
      issues: {
        nodes: [
          {
            identifier: "RIC-46",
            title: "Do thing",
            state: { name: "To Review", type: "started" },
            project: { name: "Lime" },
            labels: { nodes: [{ name: "bug" }] },
          },
        ],
      },
    });
    const items = await listOpenIssues("k", f);
    expect(items[0]).toEqual({
      identifier: "RIC-46",
      title: "Do thing",
      statusName: "To Review",
      statusType: "started",
      project: "Lime",
      labels: ["bug"],
    });
  });

  it("returns a single issue status", async () => {
    const f = fakeFetch({ issues: { nodes: [{ state: { name: "Planned" } }] } });
    expect(await getIssueStatus("k", "RIC-46", f)).toBe("Planned");
  });
});
