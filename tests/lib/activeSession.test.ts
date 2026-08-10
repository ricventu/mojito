import { describe, it, expect } from "vitest";
import { isActiveSession } from "@/lib/activeSession";
import type { SessionMeta, SessionState } from "@/server/types";

// minimal SessionMeta factory — only state matters here
function s(state: SessionState): SessionMeta {
  return {
    id: `mojito-RIC-1-${state}`, kind: "ticket", ticket: "RIC-1", state,
    launchStatus: "Todo", model: "opus", effort: "high",
    cwd: "", createdAt: "2026-08-10T10:00:00.000Z", title: "Title", labels: [],
  } as SessionMeta;
}

describe("isActiveSession", () => {
  it("counts starting, running and idle as active", () => {
    expect(isActiveSession(s("starting"))).toBe(true);
    expect(isActiveSession(s("running"))).toBe(true);
    expect(isActiveSession(s("idle"))).toBe(true);
  });

  it("counts needs-input as active — blocked, but the tmux is still there", () => {
    expect(isActiveSession(s("needs-input"))).toBe(true);
  });

  it("counts done and failed as finished", () => {
    expect(isActiveSession(s("done"))).toBe(false);
    expect(isActiveSession(s("failed"))).toBe(false);
  });
});
