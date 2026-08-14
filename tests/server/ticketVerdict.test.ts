import { describe, it, expect, vi } from "vitest";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { QaVerdictError } from "@/server/qaVerdict";

function deps(over: Record<string, unknown> = {}) {
  return {
    getIssueStatus: vi.fn(async () => "To QA"),
    resolveVerdict: vi.fn(async () => ({ done: "merged", commit: "abc1234" }) as const),
    retireStaleSession: vi.fn(async () => {}),
    ...over,
  };
}

describe("resolveTicketVerdict", () => {
  it("approve-local at To QA resolves the verdict, returns its result, then clears a stale session", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(res).toEqual({ ok: true, result: { done: "merged", commit: "abc1234" } });
    expect(d.resolveVerdict).toHaveBeenCalledWith({ ticket: "RIC-110", arg: "approve-local" });
    expect(d.retireStaleSession).toHaveBeenCalledWith("RIC-110");
  });

  it("accepts approve-mr and passes the MR result through", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => ({ done: "mr-created", url: "https://x/mr/1" }) as const) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve-mr" }, d);
    expect(res).toEqual({ ok: true, result: { done: "mr-created", url: "https://x/mr/1" } });
  });

  it("returns 409 and touches nothing when the ticket is not at To QA", async () => {
    const d = deps({ getIssueStatus: vi.fn(async () => "In Progress") });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(res).toEqual({ ok: false, code: 409, error: "ticket is not at To QA" });
    expect(d.resolveVerdict).not.toHaveBeenCalled();
    expect(d.retireStaleSession).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid arg without checking status", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "nope" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "invalid arg" });
    expect(d.getIssueStatus).not.toHaveBeenCalled();
  });

  it("rejects the retired bare 'approve' arg", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "invalid arg" });
  });

  it("rejects the retired 'reject' arg", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "reject" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "invalid arg" });
    expect(d.getIssueStatus).not.toHaveBeenCalled();
  });

  it("maps QaVerdictError to 400 and skips the cleanup", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new QaVerdictError("no worktree for ticket"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "no worktree for ticket" });
    expect(d.retireStaleSession).not.toHaveBeenCalled();
  });

  it("maps a generic error to 422 and skips the cleanup", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new Error("Linear down"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve-local" }, d);
    expect(res).toEqual({ ok: false, code: 422, error: "Linear down" });
    expect(d.retireStaleSession).not.toHaveBeenCalled();
  });
});
