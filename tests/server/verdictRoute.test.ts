import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MergeOutcome } from "@/server/merge";

// vi.mock is hoisted above the imports, so every spy has to be hoisted with it.
const h = vi.hoisted(() => ({
  getIssueStatus: vi.fn(async () => "To QA"),
  setIssueStatus: vi.fn(async () => {}),
  // attachments typed explicitly, not left to infer as never[], so a later
  // mockImplementation can hand back a non-empty attachments array.
  getIssueContent: vi.fn(async () => ({
    description: "the ticket description", attachments: [] as { title: string; url: string }[],
  })),
  downloadLinearAsset: vi.fn(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" })),
  prepareTicketAssets: vi.fn(async (input: { attachments: { title: string; url: string }[] }) =>
    ({ assets: [], attachments: input.attachments })),
  mergeTicketBranch: vi.fn(async () => ({ status: "merged", commit: "abc1234" }) as MergeOutcome),
  repoRootFromWorktree: vi.fn(async () => "/code/mojito" as string | null),
  // Takes an (unused) param so mock.calls[0][0] indexes into a non-empty tuple below.
  launchSession: vi.fn(async (_req: unknown) => ({ ok: true, meta: {} }) as { ok: boolean; reason?: string }),
  launchMergeFixSession: vi.fn(async () => ({ ok: true, meta: {} }) as { ok: boolean; reason?: string }),
  retireDeadSession: vi.fn(async () => true),
  // Hoisted so the tests can assert the one thing the verdict must never do: close a session.
  closeSession: vi.fn(async () => ({ closed: true, forced: false })),
  resolveTicketWorktree: vi.fn(() => "/code/mojito/.worktrees/ric-110" as string | null),
  resolveTicketCwd: vi.fn(() => "/code/mojito" as string | null),
  resolvePathForProject: vi.fn(() => "/code/mojito" as string | null),
  registryGet: vi.fn((_id: string) => undefined as unknown),
  hasNothingToMerge: vi.fn(async () => true),
}));

vi.mock("@/server/linear", () => ({
  getIssueStatus: h.getIssueStatus, setIssueStatus: h.setIssueStatus,
  getIssueContent: h.getIssueContent, downloadLinearAsset: h.downloadLinearAsset,
}));
vi.mock("@/server/ticketAssets", async () => {
  // Pins the mock to the real constant rather than a hand-copied number, so this test
  // would fail if MAX_ASSET_BYTES ever changed without the assertion being updated too.
  const actual = await vi.importActual<typeof import("@/server/ticketAssets")>("@/server/ticketAssets");
  return { prepareTicketAssets: h.prepareTicketAssets, MAX_ASSET_BYTES: actual.MAX_ASSET_BYTES };
});
vi.mock("@/server/merge", () => ({
  mergeTicketBranch: h.mergeTicketBranch, repoRootFromWorktree: h.repoRootFromWorktree,
}));
vi.mock("@/server/launch", () => ({
  launchSession: h.launchSession, launchMergeFixSession: h.launchMergeFixSession,
}));
vi.mock("@/server/retireSession", () => ({ retireDeadSession: h.retireDeadSession }));
vi.mock("@/server/ticketMergeState", () => ({ hasNothingToMerge: h.hasNothingToMerge }));
vi.mock("@/server/ticketCwd", () => ({
  resolveTicketWorktree: h.resolveTicketWorktree, resolveTicketCwd: h.resolveTicketCwd,
}));
vi.mock("@/server/projects", () => ({
  loadProjectMap: () => ({}), resolvePathForProject: h.resolvePathForProject,
}));
vi.mock("@/server/tmux", () => ({
  closeSession: h.closeSession,
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
  h.getIssueContent.mockImplementation(async () => ({ description: "the ticket description", attachments: [] }));
  h.downloadLinearAsset.mockImplementation(async () => ({ bytes: Buffer.from([1]), contentType: "image/png" }));
  h.prepareTicketAssets.mockImplementation(async (input) => ({ assets: [], attachments: input.attachments }));
  h.mergeTicketBranch.mockImplementation(async () => ({ status: "merged", commit: "abc1234" }));
  h.launchSession.mockImplementation(async () => ({ ok: true, meta: {} }));
  h.launchMergeFixSession.mockImplementation(async () => ({ ok: true, meta: {} }));
  h.resolveTicketWorktree.mockImplementation(() => "/code/mojito/.worktrees/ric-110");
  h.resolveTicketCwd.mockImplementation(() => "/code/mojito");
  h.resolvePathForProject.mockImplementation(() => "/code/mojito");
  h.repoRootFromWorktree.mockImplementation(async () => "/code/mojito");
  h.registryGet.mockImplementation(() => undefined);
  h.hasNothingToMerge.mockImplementation(async () => true);
  h.retireDeadSession.mockImplementation(async () => true);
  h.closeSession.mockImplementation(async () => ({ closed: true, forced: false }));
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
    expect(h.repoRootFromWorktree).not.toHaveBeenCalled(); // nothing to ask git about
  });

  it("resolves the main checkout from git when the project is unmapped, and merges", async () => {
    h.resolvePathForProject.mockImplementation(() => null);
    h.repoRootFromWorktree.mockImplementation(async () => "/code/mojito");
    const res = await POST(req(approve), params());
    expect(res.status).toBe(200);
    expect(h.repoRootFromWorktree).toHaveBeenCalledWith("/code/mojito/.worktrees/ric-110");
    expect(h.mergeTicketBranch).toHaveBeenCalledWith({
      worktree: "/code/mojito/.worktrees/ric-110", repoRoot: "/code/mojito", mode: "local",
    });
  });

  it("resolves the main checkout from git when no projectName is sent at all", async () => {
    const res = await POST(req({ arg: "approve-local", title: "Some ticket" }), params());
    expect(res.status).toBe(200);
    expect(h.resolvePathForProject).not.toHaveBeenCalled();
    expect(h.repoRootFromWorktree).toHaveBeenCalledWith("/code/mojito/.worktrees/ric-110");
    expect(h.mergeTicketBranch).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: "/code/mojito" }));
  });

  it("reports the main-checkout failure distinctly when git cannot resolve one either", async () => {
    h.resolvePathForProject.mockImplementation(() => null);
    h.repoRootFromWorktree.mockImplementation(async () => null);
    const res = await POST(req(approve), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("cannot resolve the main checkout for the ticket worktree"),
    });
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("refuses when the worktree IS the main checkout (no ticket branch to merge)", async () => {
    h.resolveTicketWorktree.mockImplementation(() => "/code/mojito");
    const res = await POST(req(approve), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringContaining("cannot resolve the main checkout for the ticket worktree"),
    });
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

  it("a merge conflict launches the merge-fix session and leaves the status alone", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "conflict", detail: "CONFLICT in a.ts" }));
    const res = await POST(req(approve), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, result: { done: "fix-session", sessionId: "mojito-RIC-110-conflict", detail: "CONFLICT in a.ts" },
    });
    expect(h.launchMergeFixSession).toHaveBeenCalledWith(
      expect.objectContaining({ ticket: "RIC-110", projectName: "Mojito", title: "Some ticket",
        description: "the ticket description", mergeMode: "local", blocker: "CONFLICT in a.ts" }),
      expect.anything(),
    );
    expect(h.setIssueStatus).not.toHaveBeenCalled();
  });

  it("a repairable merge error also launches the merge-fix session with the approved mode", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "error", detail: "dirty worktree" }));
    const res = await POST(req(approve), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, result: { done: "fix-session", sessionId: "mojito-RIC-110-conflict", detail: "dirty worktree" },
    });
    expect(h.launchMergeFixSession).toHaveBeenCalledWith(
      expect.objectContaining({ mergeMode: "local", blocker: "dirty worktree" }),
      expect.anything(),
    );
    expect(h.setIssueStatus).not.toHaveBeenCalled();
  });

  it("a resolved approve retires the ticket's work session only if its tmux is gone", async () => {
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-110-work" }));
    await POST(req(approve), params());
    expect(h.retireDeadSession).toHaveBeenCalledWith("mojito-RIC-110-work", expect.anything());
  });

  // The rule: no verdict ever ends a session. A work session still alive at the gate is the
  // rework channel, and killing it mid-turn is exactly what this route used to do.
  it("never closes a session — on any verdict", async () => {
    h.registryGet.mockImplementation(() => ({ id: "mojito-RIC-110-work" }));
    await POST(req(approve), params());
    await POST(req({ arg: "mark-done" }), params());
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "conflict", detail: "CONFLICT in a.ts" }));
    await POST(req(approve), params());
    expect(h.closeSession).not.toHaveBeenCalled();
  });

  // A fix session that is still alive is where the user is already working: hand it back
  // rather than replacing it (which is only possible by killing it first).
  it("a conflict hands back the live fix session instead of relaunching over it", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "conflict", detail: "CONFLICT in a.ts" }));
    h.launchMergeFixSession.mockImplementation(async () => ({ ok: false, reason: "duplicate" }));
    const res = await POST(req(approve), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, result: { done: "fix-session", sessionId: "mojito-RIC-110-conflict", detail: "CONFLICT in a.ts" },
    });
    expect(h.closeSession).not.toHaveBeenCalled();
  });

  it("422s when the merge-fix session fails to launch for any other reason", async () => {
    h.mergeTicketBranch.mockImplementation(async () => ({ status: "conflict", detail: "CONFLICT in a.ts" }));
    h.launchMergeFixSession.mockImplementation(async () => ({ ok: false, reason: "no-repo" }));
    const res = await POST(req(approve), params());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: expect.stringContaining("no-repo") });
  });

  it("400s a reject body and touches neither git nor Linear", async () => {
    const res = await POST(req({ arg: "reject", reason: "layout broken" }), params("RIC-110"));
    expect(res.status).toBe(400);
    expect(h.setIssueStatus).not.toHaveBeenCalled();
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
    expect(h.launchSession).not.toHaveBeenCalled();
  });

  it("mark-done moves the ticket to Done without merging", async () => {
    h.hasNothingToMerge.mockResolvedValue(true);
    const res = await POST(req({ arg: "mark-done" }), params("RIC-110"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: { done: "marked-done" } });
    expect(h.setIssueStatus).toHaveBeenCalledWith(expect.anything(), "RIC-110", "Done");
    expect(h.mergeTicketBranch).not.toHaveBeenCalled();
  });

});
