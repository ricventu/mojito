import { effectiveCommands, EMPTY_COMMANDS, type Command } from "@mojito/shared";
import { describe, expect, it } from "vitest";
import { boardClean, cleanLabel, commandMessage, menuCommands, worktreeBadge } from "../../src/lib/commands";

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

describe("commandMessage", () => {
  it("says whether the command's session started or was already open", () => {
    expect(commandMessage("Deps", false)).toBe("Started Deps");
    expect(commandMessage("Clean", true)).toBe("Clean is already open");
  });
});

const custom = (id: string, name: string, project: string | null): Command => ({
  id,
  name,
  prompt: "p",
  icon: "zap",
  project,
  excluded: [],
  model: "sonnet",
  effort: "high",
});

describe("menuCommands / boardClean", () => {
  const effective = effectiveCommands({
    items: [custom("cmd-aaaaaa", "Deps", null), custom("cmd-bbbbbb", "Web only", "Web"), custom("cmd-cccccc", "Api only", "Api")],
    removed: [],
  });

  it("menuCommands holds the project's commands without Clean", () => {
    expect(menuCommands(effective, "Web").map((c) => c.name)).toEqual(["Deps", "Web only"]);
  });

  it("boardClean is Clean while offered, undefined once removed", () => {
    expect(boardClean(effective, "Web")?.id).toBe("clean");
    expect(boardClean(effectiveCommands(EMPTY_COMMANDS), "Web")?.id).toBe("clean");
    expect(boardClean(effectiveCommands({ items: [], removed: ["clean"] }), "Web")).toBeUndefined();
  });
});
