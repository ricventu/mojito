import { describe, it, expect, vi } from "vitest";
import { resolveQaVerdict, QaVerdictError, QA_ARGS } from "@/server/qaVerdict";
import type { MergeOutcome } from "@/server/merge";

function deps(outcome: MergeOutcome = { status: "merged", commit: "abc1234" }) {
  return {
    merge: vi.fn(async () => outcome),
    setIssueStatus: vi.fn(async () => {}),
    launchRework: vi.fn(async () => {}),
    launchConflictFix: vi.fn(async () => "mojito-RIC-110-conflict"),
  };
}

describe("QA_ARGS", () => {
  it("is the exact accepted verdict set", () => {
    expect([...QA_ARGS]).toEqual(["approve-local", "approve-mr", "reject"]);
  });
});

describe("resolveQaVerdict approve", () => {
  it("approve-local merges locally and moves the ticket to Done", async () => {
    const d = deps({ status: "merged", commit: "abc1234" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(d.merge).toHaveBeenCalledWith("local");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "Done");
    expect(res).toEqual({ done: "merged", commit: "abc1234" });
    expect(d.launchRework).not.toHaveBeenCalled();
    expect(d.launchConflictFix).not.toHaveBeenCalled();
  });

  it("approve-mr opens an MR and moves the ticket to Done", async () => {
    const d = deps({ status: "mr-created", url: "https://git.example/mr/7" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-mr" }, d);
    expect(d.merge).toHaveBeenCalledWith("mr");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "Done");
    expect(res).toEqual({ done: "mr-created", url: "https://git.example/mr/7" });
  });

  it("a merge conflict launches the conflict-fix session and writes NO status", async () => {
    const d = deps({ status: "conflict", detail: "CONFLICT (content): src/a.ts" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(d.launchConflictFix).toHaveBeenCalledWith("CONFLICT (content): src/a.ts");
    expect(d.setIssueStatus).not.toHaveBeenCalled();
    expect(res).toEqual({ done: "conflict-session", sessionId: "mojito-RIC-110-conflict" });
  });

  it("a merge error throws QaVerdictError and writes no status, launches nothing", async () => {
    const d = deps({ status: "error", detail: "worktree has uncommitted changes" });
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d))
      .rejects.toBeInstanceOf(QaVerdictError);
    expect(d.setIssueStatus).not.toHaveBeenCalled();
    expect(d.launchConflictFix).not.toHaveBeenCalled();
    expect(d.launchRework).not.toHaveBeenCalled();
  });

  it("surfaces the merge failure detail in the error message", async () => {
    const d = deps({ status: "error", detail: "repo root is on other, not main" });
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d))
      .rejects.toThrow(/repo root is on other, not main/);
  });
});

describe("resolveQaVerdict reject", () => {
  it("launches rework with the trimmed reason, THEN moves the ticket to In Progress", async () => {
    const d = deps();
    const order: string[] = [];
    d.setIssueStatus.mockImplementation(async () => { order.push("status"); });
    d.launchRework.mockImplementation(async () => { order.push("rework"); });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "  layout broken  " }, d);
    expect(d.launchRework).toHaveBeenCalledWith("layout broken");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "In Progress");
    // The reason lives only in the launched session's context file, so the status must move
    // only once that session exists.
    expect(order).toEqual(["rework", "status"]);
    expect(res).toEqual({ done: "rework-session" });
  });

  it("a failed rework launch leaves the ticket at To QA so the reject can be retried", async () => {
    const d = deps();
    d.launchRework.mockImplementation(async () => { throw new Error("duplicate session"); });
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "layout broken" }, d))
      .rejects.toThrow(/duplicate session/);
    expect(d.setIssueStatus).not.toHaveBeenCalled();
  });

  it("never merges on reject", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "nope" }, d);
    expect(d.merge).not.toHaveBeenCalled();
  });

  it("a blank reason throws and touches nothing", async () => {
    const d = deps();
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "   " }, d))
      .rejects.toBeInstanceOf(QaVerdictError);
    expect(d.setIssueStatus).not.toHaveBeenCalled();
    expect(d.launchRework).not.toHaveBeenCalled();
  });

  it("a missing reason throws", async () => {
    const d = deps();
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "reject" }, d))
      .rejects.toBeInstanceOf(QaVerdictError);
  });

  it("exposes no comment dependency at all (the reason travels in the context file)", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "reject", reason: "broken" }, d);
    expect(Object.keys(d)).toEqual(["merge", "setIssueStatus", "launchRework", "launchConflictFix"]);
  });
});
