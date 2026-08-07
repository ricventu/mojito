import { describe, it, expect } from "vitest";
import { terminalTabTitle } from "@/lib/terminalTabTitle";
import type { SessionMeta } from "@/server/types";

// Minimal SessionMeta factory — only the fields the formatter reads matter;
// the rest are filled with valid-but-irrelevant defaults.
function session(over: Partial<SessionMeta>): SessionMeta {
  return {
    kind: "ticket",
    id: "mojito-RIC-129-todo",
    ticket: "RIC-129",
    launchStatus: "Todo",
    model: "opus",
    effort: "high",
    state: "running",
    cwd: "/tmp",
    createdAt: "2026-07-16T00:00:00.000Z",
    title: "title browser con ticket",
    labels: [],
    ...over,
  };
}

describe("terminalTabTitle", () => {
  it("combines id and title with an em dash", () => {
    expect(terminalTabTitle(session({}))).toBe("RIC-129 — title browser con ticket");
  });

  it("falls back to the id alone when the title is missing", () => {
    // Cast: title is typed non-optional but can be undefined on old sidecars.
    expect(terminalTabTitle(session({ title: undefined as unknown as string }))).toBe("RIC-129");
    expect(terminalTabTitle(session({ title: "   " }))).toBe("RIC-129");
  });

  it("falls back to the title alone when there is no ticket id", () => {
    expect(terminalTabTitle(session({ ticket: "" }))).toBe("title browser con ticket");
  });

  it("falls back to Mojito for a custom session with no id and no title", () => {
    expect(terminalTabTitle(session({ ticket: "", title: "" }))).toBe("Mojito");
  });
});
