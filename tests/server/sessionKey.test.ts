import { describe, it, expect } from "vitest";
import { statusSlug, tmuxName, parseIdentifier, validateTicket, customSessionName, conflictSessionName, shellSessionName, stackSessionName } from "@/server/sessionKey";

describe("sessionKey", () => {
  it("slugs a status", () => {
    expect(statusSlug("To QA")).toBe("to-qa");
    expect(statusSlug("In Progress")).toBe("in-progress");
    expect(statusSlug("Backlog")).toBe("backlog");
  });

  it("builds a tmux-safe session name", () => {
    expect(tmuxName("RIC-46", "Done")).toBe("mojito-RIC-46-done");
    expect(tmuxName("RIC-46", "Done")).not.toMatch(/[.:\s]/);
  });

  it("collapses every work state (Backlog/Todo/In Progress) to the same session id", () => {
    // A launch-time board move (Backlog/Todo -> In Progress) must not change the tmux
    // name mid-flight, or the duplicate guard and the "open running session" lookup
    // both miss the live session (see LaunchSheet's existingId / launchSession's id).
    expect(tmuxName("RIC-46", "Backlog")).toBe("mojito-RIC-46-work");
    expect(tmuxName("RIC-46", "Todo")).toBe("mojito-RIC-46-work");
    expect(tmuxName("RIC-46", "In Progress")).toBe("mojito-RIC-46-work");
  });

  // A ticket parks at To QA while its work session stays alive. If that session dies, the
  // relaunch has to take the id its predecessor had, or the duplicate guard and the
  // "open running session" lookup would each see a different session for one ticket.
  it("gives a To QA launch the same id as the work states", () => {
    expect(tmuxName("RIC-46", "To QA")).toBe("mojito-RIC-46-work");
    expect(tmuxName("RIC-46", "In Progress")).toBe("mojito-RIC-46-work");
  });

  it("still gives the conflict session an id of its own", () => {
    expect(conflictSessionName("RIC-46")).toBe("mojito-RIC-46-conflict");
    expect(conflictSessionName("RIC-46")).not.toBe(tmuxName("RIC-46", "To QA"));
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

describe("conflictSessionName", () => {
  it("builds the conflict-fix session name for a ticket", () => {
    expect(conflictSessionName("RIC-120")).toBe("mojito-RIC-120-conflict");
  });
  it("collides with neither the work session nor the To QA session (which shares the work id)", () => {
    expect(conflictSessionName("RIC-120")).not.toBe(tmuxName("RIC-120", "In Progress"));
    expect(conflictSessionName("RIC-120")).not.toBe(tmuxName("RIC-120", "To QA"));
  });
  it("rejects a malformed ticket", () => {
    expect(() => conflictSessionName("nonsense")).toThrow();
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
