import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MergeOutcome } from "@/server/merge";

// vi.mock is hoisted above the imports, so every spy has to be hoisted with it.
const h = vi.hoisted(() => ({
  getIssueStatus: vi.fn(async () => "To QA"),
  setIssueStatus: vi.fn(async () => {}),
  getIssueDescription: vi.fn(async () => "the ticket description"),
  mergeTicketBranch: vi.fn(async () => ({ status: "merged", commit: "abc1234" }) as MergeOutcome),
  launchSession: vi.fn(async () => ({ ok: true, meta: {} }) as { ok: boolean; reason?: string }),
  launchConflictSession: vi.fn(async () => ({ ok: true, meta: {} }) as { ok: boolean; reason?: string }),
  supersedeSession: vi.fn(async () => {}),
  resolveTicketWorktree: vi.fn(() => "/code/mojito/.worktrees/ric-110" as string | null),
  resolveTicketCwd: vi.fn(() => "/code/mojito" as string | null),
  resolvePathForProject: vi.fn(() => "/code/mojito" as string | null),
  registryGet: vi.fn((_id: string) => undefined as unknown),
}));

vi.mock("@/server/linear", () => ({
  getIssueStatus: h.getIssueStatus, setIssueStatus: h.setIssueStatus,
  getIssueDescription: h.getIssueDescription,
}));
vi.mock("@/server/merge", () => ({ mergeTicketBranch: h.mergeTicketBranch }));
vi.mock("@/server/launch", () => ({
  launchSession: h.launchSession, launchConflictSession: h.launchConflictSession,
}));
vi.mock("@/server/supersede", () => ({ supersedeSession: h.supersedeSession }));
vi.mock("@/server/ticketCwd", () => ({
  resolveTicketWorktree: h.resolveTicketWorktree, resolveTicketCwd: h.resolveTicketCwd,
}));
vi.mock("@/server/limeProjects", () => ({
  loadProjectMap: () => ({}), resolvePathForProject: h.resolvePathForProject,
}));
vi.mock("@/server/tmux", () => ({
  closeSession: vi.fn(async () => ({ closed: true, forced: false })),
  hasSession: vi.fn(async () => false), newSession: vi.fn(async () => {}), pipePane: vi.fn(async () => {}),
}));
vi.mock("@/server/app", () => ({
  getConfig: () => ({ token: "test-token", linearApiKey: "k", stateDir: "/state", port: 4711,
    projectsPath: "/projects.json" }),
  getRegistry: () => ({ get: h.registryGet }),
}));

import { POST } from "@/app/api/tickets/[id]/verdict/route";

const TOKEN = "test-token";
function req(body: unknown, auth = true): Request {
  return new Request("http://localhost/api/tickets/RIC-110/verdict", {
    method: "POST",
    headers: auth ? { "x-mojito-token": TOKEN, "Content-Type": "application/json" } : {},
    body: JSON.stringify(body),
  });
}
const params = (id = "RIC-110") => ({ params: Promise.resolve({ id }) });
const approve = { arg: "approve-local", projectName: "Mojito", title: "Some ticket" };

beforeEach(() => {
  vi.clearAllMocks();
  h.getIssueStatus.mockImplementation(async () => "To QA");
  h.getIssueDescription.mockImplementation(async () => "the ticket description");
  h.mergeTicketBranch.mockImplementation(async () => ({ status: "merged", commit: "abc1234" }));
  h.launchSession.mockImplementation(async () => ({ ok: true, meta: {} }));
  h.launchConflictSession.mockImplementation(async () => ({ ok: true, meta: {} }));
  h.resolveTicketWorktree.mockImplementation(() => "/code/mojito/.worktrees/ric-110");
  h.resolveTicketCwd.mockImplementation(() => "/code/mojito");
  h.resolvePathForProject.mockImplementation(() => "/code/mojito");
  h.registryGet.mockImplementation(() => undefined);
});

describe("/api/tickets/[id]/verdict", () => {
  it("401 without a token", async () => {
    expect((await POST(req(approve, false), params())).status).toBe(401);
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("400 on an invalid ticket identifier", async () => {
    expect((await POST(req(approve), params("nope"))).status).toBe(400);
  });

  it("400 on an unknown arg, including the retired bare 'approve'", async () => {
    expect((await POST(req({ ...approve, arg: "approve" }), params())).status).toBe(400);
    expect((await POST(req({ ...approve, arg: "nope" }), params())).status).toBe(400);
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("409 when the ticket is not at To QA", async () => {
    h.getIssueStatus.mockImplementation(async () => "In Progress");
    expect((await POST(req(approve), params())).status).toBe(409);
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("approve-local merges the worktree into the project's main checkout and returns the result", async () => {
    const res = await POST(req(approve), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { done: "merged", commit: "abc1234" } });
    expect(h.mergeTicketBranch).toHaveBeenCalledWith({
      worktree: "/code/mojito/.worktrees/ric-110", repoRoot: "/code/mojito", mode: "local",
    });
    expect(h.setIssueStatus).toHaveBeenCalledWith("k", "RIC-110", "Done");
    expect(h.launchSession).not.toHaveBeenCalled();
  });

  it("approve-mr passes the mr mode through", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "mr-created", url: "https://x/mr/1" }));
    const res = await POST(req({ ...approve, arg: "approve-mr" }), params());
    expect(res.status).toBe(200);
    expect(h.mergeTicketBranch).toHaveBeenCalledWith(expect.objectContaining({ mode: "mr" }));
    expect(await res.json()).toEqual({ ok: true, result: { done: "mr-created", url: "https://x/mr/1" } });
  });

  // A merge that never happened is a QaVerdictError -> 400 (the arg was refused), which the
  // sheet surfaces verbatim; the distinction that matters is that nothing was mutated.
  it("400 without merging when the ticket has no worktree of its own", async () => {
    h.resolveTicketWorktree.mockImplementation(() => null);
    const res = await POST(req(approve), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("no worktree for ticket") });
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
    expect(h.setIssueStatus).not.toHaveBeenCalled();
  });

  it("400 without merging when the worktree is the repo root itself", async () => {
    h.resolveTicketWorktree.mockImplementation(() => "/code/mojito");
    expect((await POST(req(approve), params())).status).toBe(400);
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("a rebase conflict launches the conflict session and leaves the status alone", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "conflict", detail: "CONFLICT in a.ts" }));
    const res = await POST(req(approve), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { done: "conflict-session" } });
    expect(h.launchConflictSession).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: "RIC-110", projectName: "Mojito", title: "Some ticket",
        description: "the ticket description" }),
      expect.anything(),
    );
    expect(h.setIssueStatus).not.toHaveBeenCalled();
  });

  it("a merge error is refused with no status write and no session", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "error", detail: "dirty worktree" }));
    const res = await POST(req(approve), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("dirty worktree") });
    expect(h.setIssueStatus).not.toHaveBeenCalled();
    expect(h.launchConflictSession).not.toHaveBeenCalled();
  });

  it("reject moves the ticket to In Progress and launches rework carrying the reason", async () => {
    const res = await POST(req({ arg: "reject", reason: "layout broken", projectName: "Mojito", title: "T" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { done: "rework-session" } });
    expect(h.setIssueStatus).toHaveBeenCalledWith("k", "RIC-110", "In Progress");
    expect(h.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: "RIC-110", status: "In Progress", rejectReason: "layout broken",
        description: "the ticket description", labels: [] }),
      expect.anything(),
    );
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("reject never supersedes the rework session it just launched", async () => {
    // A stale -work session exists: launchRework retires it before relaunching, and the
    // post-verdict cleanup must not then kill the fresh session sharing that id.
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-110-work" }));
    await POST(req({ arg: "reject", reason: "broken", projectName: "Mojito", title: "T" }), params());
    expect(h.supersedeSession).toHaveBeenCalledTimes(1);
    expect(h.supersedeSession).toHaveBeenCalledWith("mojito-RIC-110-work", expect.anything());
  });

  it("a resolved approve retires the ticket's finished work session", async () => {
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-110-work" }));
    await POST(req(approve), params());
    expect(h.supersedeSession).toHaveBeenCalledWith("mojito-RIC-110-work", expect.anything());
  });

  it("400 when reject carries no reason, and nothing is launched", async () => {
    const res = await POST(req({ arg: "reject", projectName: "Mojito", title: "T" }), params());
    expect(res.status).toBe(400);
    expect(h.setIssueStatus).not.toHaveBeenCalled();
    expect(h.launchSession).not.toHaveBeenCalled();
  });

  it("launches rework with an empty description when Linear cannot be read", async () => {
    h.getIssueDescription.mockImplementation(async () => { throw new Error("Linear down"); });
    const res = await POST(req({ arg: "reject", reason: "broken", projectName: "Mojito", title: "T" }), params());
    expect(res.status).toBe(200);
    expect(h.launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ description: "" }), expect.anything(),
    );
  });

  it("422 when the rework session cannot be launched", async () => {
    h.launchSession.mockImplementation(async () => ({ ok: false, reason: "duplicate" }));
    const res = await POST(req({ arg: "reject", reason: "broken", projectName: "Mojito", title: "T" }), params());
    expect(res.status).toBe(422);
  });
});
