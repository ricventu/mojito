import { describe, it, expect } from "vitest";
import { activeSessionLevel } from "@/lib/ticketSessionLevel";
import type { SessionMeta, SessionState } from "@/server/types";

// minimal SessionMeta factory — only ticket and state matter here
function s(ticket: string, state: SessionState): SessionMeta {
  return {
    id: `${ticket}-${state}`, kind: "ticket", ticket, state,
    launchStatus: "", model: "", effort: "low",
    cwd: "", createdAt: "2026-07-14T10:00:00.000Z", title: "", labels: [],
  } as SessionMeta;
}

describe("activeSessionLevel", () => {
  it("returns null when there are no sessions", () => {
    expect(activeSessionLevel("RIC-1", [])).toBeNull();
  });

  it("returns null when only done/failed sessions exist for the ticket", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "done"), s("RIC-1", "failed")])).toBeNull();
  });

  it("returns 'run' for a running or starting session", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "running")])).toBe("run");
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "starting")])).toBe("run");
  });

  it("returns 'attn' for a needs-input session", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "needs-input")])).toBe("attn");
  });

  it("prioritizes needs-input over running", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-1", "running"), s("RIC-1", "needs-input")])).toBe("attn");
  });

  it("only counts sessions for the given ticket", () => {
    const sessions = [s("RIC-2", "needs-input"), s("RIC-1", "running")];
    expect(activeSessionLevel("RIC-1", sessions)).toBe("run");
  });

  it("returns null when all active sessions belong to other tickets", () => {
    expect(activeSessionLevel("RIC-1", [s("RIC-2", "running")])).toBeNull();
  });
});

describe("gate for a ticket-scoped action that requires no active session", () => {
  // A ticket-scoped action (e.g. a one-off worktree sync) should be eligible only when
  // the ticket has no active session.
  it("is eligible (null) when only a finished session exists", () => {
    expect(activeSessionLevel("RIC-120", [s("RIC-120", "done")])).toBeNull();
  });
  it("is not eligible while a session is starting/running", () => {
    expect(activeSessionLevel("RIC-120", [s("RIC-120", "starting")])).toBe("run");
  });
});
