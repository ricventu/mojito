import { describe, it, expect } from "vitest";
import { pullMessage, syntheticStackSession, type PullResponse } from "@/lib/stacks";

describe("pullMessage", () => {
  it("formats a successful update response", () => {
    const response: PullResponse = {
      status: "updated",
      from: "abc1234",
      to: "def5678",
    };
    const msg = pullMessage(response);
    expect(msg).toContain("updated");
    expect(msg).toContain("abc1234");
    expect(msg).toContain("def5678");
  });

  it("formats an up-to-date response", () => {
    const response: PullResponse = {
      status: "up-to-date",
      from: "abc1234",
      to: "abc1234",
    };
    const msg = pullMessage(response);
    expect(msg).toContain("up-to-date");
  });

  it("formats an error response without detail", () => {
    const response: PullResponse = {
      error: "diverged",
    };
    const msg = pullMessage(response);
    expect(msg).toContain("diverged");
  });

  it("formats an error response with detail", () => {
    const response: PullResponse = {
      error: "failed",
      detail: "network error",
    };
    const msg = pullMessage(response);
    expect(msg).toContain("failed");
    expect(msg).toContain("network error");
  });
});

describe("syntheticStackSession", () => {
  it("creates a session with all required fields", () => {
    const session = syntheticStackSession("TestProject");
    expect(session.kind).toBe("shell");
    expect(session.id).toMatch(/^stack-/);
    expect(session.ticket).toBe("");
    expect(session.launchStatus).toBe("");
    expect(session.model).toBe("fable");
    expect(session.effort).toBe("");
    expect(session.autoAdvance).toBe(false);
    expect(session.state).toBe("running");
    expect(session.title).toBe("");
    expect(session.labels).toEqual([]);
  });

  it("sets projectName to the provided project", () => {
    const session = syntheticStackSession("MyProject");
    expect(session.projectName).toBe("MyProject");
  });

  it("has a valid cwd and createdAt", () => {
    const session = syntheticStackSession("TestProject");
    expect(typeof session.cwd).toBe("string");
    expect(session.cwd.length).toBeGreaterThan(0);
    expect(typeof session.createdAt).toBe("string");
    expect(session.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
  });

  it("generates unique ids for different projects", () => {
    const session1 = syntheticStackSession("Project1");
    const session2 = syntheticStackSession("Project2");
    expect(session1.id).not.toBe(session2.id);
  });
});
