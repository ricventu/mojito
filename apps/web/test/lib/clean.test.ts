import { describe, expect, it } from "vitest";
import { cleanLabel, cleanMessage, worktreeBadge } from "../../src/lib/clean";

describe("worktreeBadge", () => {
  it("shows nothing with no linked worktree, or before the count is known", () => {
    expect(worktreeBadge(0)).toBeNull();
    expect(worktreeBadge(undefined)).toBeNull();
  });

  it("shows the count, capped at 9+", () => {
    expect(worktreeBadge(1)).toBe("1");
    expect(worktreeBadge(9)).toBe("9");
    expect(worktreeBadge(10)).toBe("9+");
  });
});

describe("cleanLabel", () => {
  it("names the project and, when known, its worktrees", () => {
    expect(cleanLabel("Web", undefined)).toBe("Clean Web");
    expect(cleanLabel("Web", 0)).toBe("Clean Web");
    expect(cleanLabel("Web", 1)).toBe("Clean Web (1 worktree)");
    expect(cleanLabel("Web", 4)).toBe("Clean Web (4 worktrees)");
  });
});

describe("cleanMessage", () => {
  it("says whether the clean session started or was already open", () => {
    expect(cleanMessage(false)).toBe("Claude is looking for merged branches and worktrees");
    expect(cleanMessage(true)).toBe("The clean session is already open");
  });
});
