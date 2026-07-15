import { describe, it, expect, vi } from "vitest";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { QaVerdictError } from "@/server/qaVerdict";

function deps(over: Record<string, unknown> = {}) {
  return {
    getIssueStatus: vi.fn(async () => "To QA"),
    resolveVerdict: vi.fn(async () => {}),
    supersedeStaleSession: vi.fn(async () => {}),
    ...over,
  };
}

describe("resolveTicketVerdict", () => {
  it("approve at To QA resolves the verdict then supersedes the stale session", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: true, arg: "approve" });
    expect(d.resolveVerdict).toHaveBeenCalledWith({ ticket: "RIC-110", arg: "approve", reason: undefined });
    expect(d.supersedeStaleSession).toHaveBeenCalledWith("RIC-110");
  });

  it("reject passes the reason through", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "reject", reason: "broken" }, d);
    expect(res).toEqual({ ok: true, arg: "reject" });
    expect(d.resolveVerdict).toHaveBeenCalledWith({ ticket: "RIC-110", arg: "reject", reason: "broken" });
  });

  it("returns 409 and touches nothing when the ticket is not at To QA", async () => {
    const d = deps({ getIssueStatus: vi.fn(async () => "To Code") });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: false, code: 409, error: "ticket is not at To QA" });
    expect(d.resolveVerdict).not.toHaveBeenCalled();
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid arg without checking status", async () => {
    const d = deps();
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "nope" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "invalid arg" });
    expect(d.getIssueStatus).not.toHaveBeenCalled();
  });

  it("maps QaVerdictError to 400 and skips supersede", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new QaVerdictError("rejection reason required"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "reject", reason: "" }, d);
    expect(res).toEqual({ ok: false, code: 400, error: "rejection reason required" });
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });

  it("maps a generic error to 422 and skips supersede", async () => {
    const d = deps({ resolveVerdict: vi.fn(async () => { throw new Error("Linear down"); }) });
    const res = await resolveTicketVerdict({ ticket: "RIC-110", arg: "approve" }, d);
    expect(res).toEqual({ ok: false, code: 422, error: "Linear down" });
    expect(d.supersedeStaleSession).not.toHaveBeenCalled();
  });
});
