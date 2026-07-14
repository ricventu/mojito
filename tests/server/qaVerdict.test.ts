import { describe, it, expect, vi } from "vitest";
import { resolveQaVerdict, QaVerdictError } from "@/server/qaVerdict";

function deps() {
  return { setIssueStatus: vi.fn(async () => {}), postComment: vi.fn(async () => {}) };
}

describe("resolveQaVerdict", () => {
  it("approve moves the ticket to To Merge and posts no comment", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "To Merge");
    expect(d.postComment).not.toHaveBeenCalled();
  });

  it("reject posts the reason comment then moves to To Code, in that order", async () => {
    const d = deps();
    const order: string[] = [];
    d.postComment.mockImplementation(async () => { order.push("comment"); });
    d.setIssueStatus.mockImplementation(async () => { order.push("status"); });
    await resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "layout broken" }, d);
    expect(d.postComment).toHaveBeenCalledWith("RIC-110", "QA rejected — layout broken");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "To Code");
    expect(order).toEqual(["comment", "status"]);
  });

  it("reject with a blank reason throws and touches nothing", async () => {
    const d = deps();
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "   " }, d))
      .rejects.toBeInstanceOf(QaVerdictError);
    expect(d.postComment).not.toHaveBeenCalled();
    expect(d.setIssueStatus).not.toHaveBeenCalled();
  });
});
