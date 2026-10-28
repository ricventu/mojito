import { describe, expect, it, vi } from "vitest";
import { createLinearMcp } from "../../src/tasks/linearTools";
import { callTool } from "./mcp";

function fakeLinear() {
  return {
    listLabels: vi.fn(async (_team: string) => [
      { id: "l1", name: "Bug" },
      { id: "l2", name: "Feature" },
    ]),
    createIssue: vi.fn(async (_input: { teamKey: string; project: string; title: string; description: string; labelId?: string }) => ({
      identifier: "RIC-9",
      url: "https://linear.app/x/issue/RIC-9",
    })),
  };
}

describe("createLinearMcp", () => {
  it("is the mojito-linear in-process server", () => {
    const mcp = createLinearMcp(fakeLinear(), () => {});
    expect(mcp.type).toBe("sdk");
    expect(mcp.name).toBe("mojito-linear");
  });

  it("create_issue creates the issue, reports it and answers identifier and url", async () => {
    const linear = fakeLinear();
    const onCreated = vi.fn();
    const mcp = createLinearMcp(linear, onCreated);
    const res = await callTool(mcp, "create_issue", { team: "RIC", project: "Web", title: "T", description: "D", labelId: "l1" });
    expect(linear.createIssue).toHaveBeenCalledWith({ teamKey: "RIC", project: "Web", title: "T", description: "D", labelId: "l1" });
    expect(onCreated).toHaveBeenCalledWith({ identifier: "RIC-9", url: "https://linear.app/x/issue/RIC-9" });
    const text = res.content.map((c) => c.text).join("");
    expect(text).toContain("RIC-9");
    expect(text).toContain("https://linear.app/x/issue/RIC-9");
    expect(res.isError).toBeFalsy();
  });

  it("create_issue without a label sends no labelId", async () => {
    const linear = fakeLinear();
    await callTool(createLinearMcp(linear, () => {}), "create_issue", { team: "RIC", project: "Web", title: "T", description: "D" });
    expect(linear.createIssue).toHaveBeenCalledWith({ teamKey: "RIC", project: "Web", title: "T", description: "D" });
  });

  it("refuses a second create_issue: one task, one ticket", async () => {
    const linear = fakeLinear();
    const onCreated = vi.fn();
    const mcp = createLinearMcp(linear, onCreated);
    await callTool(mcp, "create_issue", { team: "RIC", project: "Web", title: "T", description: "D" });
    const again = await callTool(mcp, "create_issue", { team: "RIC", project: "Web", title: "T2", description: "D2" });
    expect(again.isError).toBe(true);
    expect(linear.createIssue).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("a Linear failure is a tool error, not a creation", async () => {
    const linear = fakeLinear();
    linear.createIssue.mockRejectedValue(new Error("Linear API error: 500"));
    const onCreated = vi.fn();
    const res = await callTool(createLinearMcp(linear, onCreated), "create_issue", { team: "RIC", project: "Web", title: "T", description: "D" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Linear API error: 500");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("list_labels answers the team's labels with their ids", async () => {
    const linear = fakeLinear();
    const res = await callTool(createLinearMcp(linear, () => {}), "list_labels", { team: "RIC" });
    expect(linear.listLabels).toHaveBeenCalledWith("RIC");
    expect(JSON.parse(res.content[0].text ?? "")).toEqual([
      { id: "l1", name: "Bug" },
      { id: "l2", name: "Feature" },
    ]);
  });
});
