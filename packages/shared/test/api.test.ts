import { describe, expect, it } from "vitest";
import { LaunchBody, LaunchTicketBody, ProjectBody, SettingsBody, StatusBody } from "../src/index";

describe("LaunchTicketBody", () => {
  const ok = { kind: "ticket", ticket: "RIC-12", model: "opus", effort: "high", brainstorming: true };

  it("accepts a valid ticket launch", () => {
    expect(LaunchTicketBody.safeParse(ok).success).toBe(true);
  });

  it("rejects a lowercase ticket id", () => {
    expect(LaunchTicketBody.safeParse({ ...ok, ticket: "ric-12" }).success).toBe(false);
  });

  it("rejects a ticket id carrying shell metacharacters", () => {
    expect(LaunchTicketBody.safeParse({ ...ok, ticket: "RIC-12; rm -rf" }).success).toBe(false);
  });
});

describe("LaunchBody", () => {
  it("rejects a claude session without model and effort", () => {
    expect(LaunchBody.safeParse({ kind: "claude", project: null }).success).toBe(false);
  });

  it("accepts a claude session with model and effort", () => {
    expect(
      LaunchBody.safeParse({ kind: "claude", project: "Mojito", model: "sonnet", effort: "low" }).success,
    ).toBe(true);
  });

  it("accepts a shell session without model and effort", () => {
    expect(LaunchBody.safeParse({ kind: "shell", project: null }).success).toBe(true);
  });

  it("routes a ticket launch to the ticket schema", () => {
    expect(
      LaunchBody.safeParse({ kind: "ticket", ticket: "RIC-1", model: "fable", effort: "max", brainstorming: false }).success,
    ).toBe(true);
    expect(LaunchBody.safeParse({ kind: "ticket", ticket: "RIC-1" }).success).toBe(false);
  });
});

describe("ProjectBody", () => {
  it("rejects a relative path", () => {
    expect(ProjectBody.safeParse({ name: "x", path: "code/x", teamKey: "RIC" }).success).toBe(false);
  });

  it("accepts an absolute path", () => {
    expect(ProjectBody.safeParse({ name: "x", path: "/code/x", teamKey: "RIC" }).success).toBe(true);
  });
});

describe("SettingsBody and StatusBody", () => {
  it("accepts a per-status defaults record", () => {
    const r = SettingsBody.safeParse({
      statusDefaults: { Todo: { model: "opus", effort: "high" } },
      brainstormingDefault: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown model in the defaults", () => {
    const r = SettingsBody.safeParse({
      statusDefaults: { Todo: { model: "gpt", effort: "high" } },
      brainstormingDefault: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty status", () => {
    expect(StatusBody.safeParse({ status: "" }).success).toBe(false);
  });
});
