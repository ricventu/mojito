import { describe, it, expect, vi } from "vitest";
import { resolveQaVerdict, QA_ARGS } from "@/server/qaVerdict";
import type { MergeOutcome } from "@/server/merge";

function deps(outcome: MergeOutcome = { status: "merged", commit: "abc1234" }) {
  return {
    merge: vi.fn(async () => outcome),
    setIssueStatus: vi.fn(async () => {}),
    launchMergeFix: vi.fn(async () => "mojito-RIC-110-conflict"),
  };
}

describe("QA_ARGS", () => {
  it("is the exact accepted verdict set", () => {
    expect([...QA_ARGS]).toEqual(["approve-local", "approve-mr"]);
  });
});

describe("resolveQaVerdict approve", () => {
  it("approve-local merges locally and moves the ticket to Done", async () => {
    const d = deps({ status: "merged", commit: "abc1234" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(d.merge).toHaveBeenCalledWith("local");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "Done");
    expect(res).toEqual({ done: "merged", commit: "abc1234" });
    expect(d.launchMergeFix).not.toHaveBeenCalled();
  });

  it("approve-mr opens an MR and moves the ticket to Done", async () => {
    const d = deps({ status: "mr-created", url: "https://git.example/mr/7" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-mr" }, d);
    expect(d.merge).toHaveBeenCalledWith("mr");
    expect(d.setIssueStatus).toHaveBeenCalledWith("RIC-110", "Done");
    expect(res).toEqual({ done: "mr-created", url: "https://git.example/mr/7" });
  });

  it("a merge conflict launches the merge-fix session and writes NO status", async () => {
    const d = deps({ status: "conflict", detail: "CONFLICT (content): src/a.ts" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(d.launchMergeFix).toHaveBeenCalledWith("CONFLICT (content): src/a.ts", "local");
    expect(d.setIssueStatus).not.toHaveBeenCalled();
    expect(res).toEqual({
      done: "fix-session", sessionId: "mojito-RIC-110-conflict", detail: "CONFLICT (content): src/a.ts",
    });
  });

  it("a repairable merge error also launches the merge-fix session, carrying the approved mode", async () => {
    const d = deps({ status: "error", detail: "worktree has uncommitted changes" });
    const res = await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-mr" }, d);
    expect(d.launchMergeFix).toHaveBeenCalledWith("worktree has uncommitted changes", "mr");
    expect(d.setIssueStatus).not.toHaveBeenCalled();
    expect(res).toEqual({
      done: "fix-session", sessionId: "mojito-RIC-110-conflict", detail: "worktree has uncommitted changes",
    });
  });

  it("a failed fix-session launch propagates and writes no status", async () => {
    const d = deps({ status: "error", detail: "fatal: whatever" });
    d.launchMergeFix.mockImplementation(async () => { throw new Error("no worktree"); });
    await expect(resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d))
      .rejects.toThrow(/no worktree/);
    expect(d.setIssueStatus).not.toHaveBeenCalled();
  });
});

describe("resolveQaVerdict deps", () => {
  it("no longer exposes a rework dependency", async () => {
    const d = deps();
    await resolveQaVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(Object.keys(d)).toEqual(["merge", "setIssueStatus", "launchMergeFix"]);
  });
});
