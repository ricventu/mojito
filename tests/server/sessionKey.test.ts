import { describe, it, expect } from "vitest";
import { statusSlug, tmuxName, parseIdentifier, validateTicket, customSessionName, rebaseSessionName, shellSessionName, stackSessionName } from "@/server/sessionKey";

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

describe("customSessionName", () => {
  it("builds a prefixed name from slug and unique id", () => {
    expect(customSessionName("mojito", "a1b2c3")).toBe("mojito-custom-mojito-a1b2c3");
  });
  it("uses the general slug form", () => {
    expect(customSessionName("general", "ffffff")).toBe("mojito-custom-general-ffffff");
  });
  it("distinct unique ids yield distinct names", () => {
    expect(customSessionName("x", "aaa")).not.toBe(customSessionName("x", "bbb"));
  });
});

describe("rebaseSessionName", () => {
  it("builds the rebase session name for a ticket", () => {
    expect(rebaseSessionName("RIC-120")).toBe("mojito-RIC-120-rebase");
  });
  it("does not collide with the To QA gate session name", () => {
    expect(rebaseSessionName("RIC-120")).not.toBe(tmuxName("RIC-120", "To QA"));
  });
  it("rejects a malformed ticket", () => {
    expect(() => rebaseSessionName("nonsense")).toThrow();
  });
});

describe("shellSessionName", () => {
  it("builds a prefixed name from slug and unique id", () => {
    expect(shellSessionName("mojito", "a1b2c3")).toBe("mojito-shell-mojito-a1b2c3");
  });
  it("uses the general slug form", () => {
    expect(shellSessionName("general", "ffffff")).toBe("mojito-shell-general-ffffff");
  });
  it("does not collide with a custom session name for the same slug/id", () => {
    expect(shellSessionName("x", "aaa")).not.toBe(customSessionName("x", "aaa"));
  });
});

describe("stackSessionName", () => {
  it("prefixes the slug with stack-", () => {
    expect(stackSessionName("factorybook")).toBe("stack-factorybook");
  });
  it("uses an already-sanitized slug verbatim", () => {
    expect(stackSessionName(statusSlug("Gestionale Cooperative"))).toBe("stack-gestionale-cooperative");
  });
});
