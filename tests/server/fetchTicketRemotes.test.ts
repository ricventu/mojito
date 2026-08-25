import { describe, it, expect, vi } from "vitest";
import { fetchTicketRemotes } from "@/server/fetchTicketRemotes";
import type { TicketWorktreeStatus } from "@/server/ticketWorktreeStatus";

const FETCHED: TicketWorktreeStatus = {
  exists: false,
  branches: ["main"],
  remoteBranches: ["origin/main", "origin/new-thing"],
  defaultBranch: "main",
  worktrees: [],
};

function deps(over: Partial<Parameters<typeof fetchTicketRemotes>[4]> = {}) {
  return {
    repoForTicket: vi.fn(() => "/repo" as string | null),
    fetchAllRemotes: vi.fn(async () => {}),
    getTicketWorktreeStatus: vi.fn(async () => FETCHED),
    ...over,
  };
}

describe("fetchTicketRemotes", () => {
  it("fetches the repo's remotes and answers the status read after it", async () => {
    const d = deps();
    const res = await fetchTicketRemotes("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(res).toEqual({ status: FETCHED, warning: null });
    expect(d.fetchAllRemotes).toHaveBeenCalledWith("/repo");
    expect(d.getTicketWorktreeStatus).toHaveBeenCalledWith("/cfg.json", "RIC-1", "mojito", "Some title");
  });

  // The status is what git has locally, which is exactly what a launch would branch off, so
  // it is still worth answering — the sheet shows the message beside a usable list.
  it("reports a failed fetch as a warning and still answers the status", async () => {
    const d = deps({ fetchAllRemotes: vi.fn(async () => { throw new Error("could not read from remote"); }) });
    const res = await fetchTicketRemotes("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(res.status).toEqual(FETCHED);
    expect(res.warning).toContain("could not read from remote");
  });

  it("fetches nothing when the ticket maps to no repo", async () => {
    const d = deps({ repoForTicket: vi.fn(() => null) });
    const res = await fetchTicketRemotes("/cfg.json", "RIC-1", "mojito", "Some title", d);
    expect(d.fetchAllRemotes).not.toHaveBeenCalled();
    expect(res.warning).toBeNull();
  });
});
