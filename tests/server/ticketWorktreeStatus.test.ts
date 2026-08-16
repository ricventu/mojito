import { describe, it, expect, vi } from "vitest";
import { getTicketWorktreeStatus } from "@/server/ticketWorktreeStatus";

function deps(over: Partial<Parameters<typeof getTicketWorktreeStatus>[4]> = {}) {
  return {
    repoForTicket: vi.fn(() => "/repo"),
    findExistingTicketWorktree: vi.fn(() => null as string | null),
    listLocalBranches: vi.fn(() => ["main", "dev"]),
    detectDefaultBranch: vi.fn(async () => "main"),
    ...over,
  };
}

describe("getTicketWorktreeStatus", () => {
  it("reports exists:true and skips branch lookup when a worktree already exists", async () => {
    const d = deps({ findExistingTicketWorktree: vi.fn(() => "/repo/.claude/worktrees/RIC-1-x") });
    const res = await getTicketWorktreeStatus("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(res).toEqual({ exists: true, branches: [], defaultBranch: null });
    expect(d.listLocalBranches).not.toHaveBeenCalled();
    expect(d.detectDefaultBranch).not.toHaveBeenCalled();
  });

  it("reports exists:false with the repo's local branches and detected default when none exists", async () => {
    const d = deps();
    const res = await getTicketWorktreeStatus("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(res).toEqual({ exists: false, branches: ["main", "dev"], defaultBranch: "main" });
  });

  it("falls back to a null default branch when it cannot be detected", async () => {
    const d = deps({ detectDefaultBranch: vi.fn(async () => { throw new Error("no origin/HEAD"); }) });
    const res = await getTicketWorktreeStatus("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(res).toEqual({ exists: false, branches: ["main", "dev"], defaultBranch: null });
  });

  // No resolvable repo: reports exists:true so the UI skips the create-worktree question —
  // the actual launch still answers no-repo, same as today.
  it("reports exists:true when the ticket maps to no repo", async () => {
    const d = deps({ repoForTicket: vi.fn(() => null) });
    const res = await getTicketWorktreeStatus("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(res).toEqual({ exists: true, branches: [], defaultBranch: null });
    expect(d.findExistingTicketWorktree).not.toHaveBeenCalled();
  });
});
