import { describe, it, expect } from "vitest";
import { statusSlug, tmuxName, parseIdentifier, validateTicket } from "@/server/sessionKey";

describe("sessionKey", () => {
  it("slugs a status", () => {
    expect(statusSlug("To Review")).toBe("to-review");
    expect(statusSlug("In Progress")).toBe("in-progress");
    expect(statusSlug("Backlog")).toBe("backlog");
  });

  it("builds a tmux-safe session name", () => {
    expect(tmuxName("RIC-46", "To Review")).toBe("mojito-RIC-46-to-review");
    expect(tmuxName("RIC-46", "To Review")).not.toMatch(/[.:\s]/);
  });

  it("parses an identifier", () => {
    expect(parseIdentifier("RIC-46")).toEqual({ teamKey: "RIC", number: 46 });
  });

  it("rejects a malformed ticket", () => {
    expect(() => validateTicket("nonsense")).toThrow();
    expect(() => validateTicket("RIC-46")).not.toThrow();
  });
});
