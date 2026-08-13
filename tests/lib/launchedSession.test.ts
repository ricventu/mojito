import { describe, it, expect } from "vitest";
import { launchedSession } from "@/lib/launchedSession";

const meta = {
  kind: "ticket", id: "mojito-RIC-1-work", ticket: "RIC-1", launchStatus: "Todo",
  model: "opus", effort: "high", state: "starting", cwd: "/tmp", createdAt: "2026-01-01T00:00:00.000Z",
  title: "t", labels: [],
};

describe("launchedSession", () => {
  it("returns the meta a launch answered with", () => {
    expect(launchedSession(meta)).toBe(meta);
  });

  // The fallback path: nothing to open, so the caller just closes the sheet.
  it("rejects payloads that cannot address a terminal", () => {
    expect(launchedSession(null)).toBeNull();
    expect(launchedSession("mojito-RIC-1-work")).toBeNull();
    expect(launchedSession({ error: "duplicate" })).toBeNull();
    expect(launchedSession({ ...meta, id: "" })).toBeNull();
  });
});
