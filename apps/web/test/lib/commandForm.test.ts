import { DEFAULT_COMMANDS, EMPTY_COMMANDS, effectiveCommands, type Command, type CommandsSetting } from "@mojito/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/api";
import {
  applyAssist,
  commandGroups,
  commandTag,
  deleteCommand,
  draftError,
  importableRows,
  importErrorMessage,
  peerCommands,
  newDraft,
  resetDefault,
  restoreBlocked,
  restoreDefault,
  saveDraft,
  type CommandDraft,
} from "../../src/lib/commandForm";

const CLEAN = DEFAULT_COMMANDS.find((c) => c.id === "clean")!;

const custom = (over: Partial<Command> = {}): Command => ({
  id: "cmd-111111",
  name: "Deps",
  prompt: "Update the dependencies.",
  icon: "package",
  project: null,
  model: "sonnet",
  effort: "medium",
  ...over,
});

const setting = (items: Command[] = [], removed: string[] = []): CommandsSetting => ({ items, removed });

describe("newDraft", () => {
  it("starts empty, with the zap icon, the given defaults and no project", () => {
    expect(newDraft({ model: "opus", effort: "xhigh" })).toEqual({
      id: null,
      name: "",
      prompt: "",
      icon: "zap",
      project: null,
      model: "opus",
      effort: "xhigh",
    });
  });

  it("binds the given project", () => {
    expect(newDraft({ model: "opus", effort: "high" }, "Web").project).toBe("Web");
  });
});

describe("applyAssist", () => {
  const answer = { name: "Review", prompt: "Review the last commit.", icon: "eye" as const };

  it("fills name, prompt and icon of a new command", () => {
    const draft = { ...newDraft({ model: "opus", effort: "high" }), name: "typed", prompt: "rough idea" };
    expect(applyAssist(draft, answer)).toMatchObject({ id: null, name: "Review", prompt: "Review the last commit.", icon: "eye" });
  });

  it("keeps a typed name on an existing command", () => {
    const draft: CommandDraft = custom();
    expect(applyAssist(draft, answer)).toMatchObject({ id: "cmd-111111", name: "Deps", prompt: "Review the last commit.", icon: "eye" });
  });

  it("fills an existing command's empty name", () => {
    const draft: CommandDraft = custom({ name: "  " });
    expect(applyAssist(draft, answer).name).toBe("Review");
  });

  it("keeps model, effort and project", () => {
    const draft: CommandDraft = custom({ project: "Web", model: "haiku", effort: "low" });
    expect(applyAssist(draft, answer)).toMatchObject({ project: "Web", model: "haiku", effort: "low" });
  });
});

describe("saveDraft", () => {
  it("stores nothing for an unchanged default", () => {
    expect(saveDraft(EMPTY_COMMANDS, { ...CLEAN })).toEqual(EMPTY_COMMANDS);
  });

  it("stores an edited default under its own id", () => {
    const edited = { ...CLEAN, icon: "trash-2" as const };
    expect(saveDraft(EMPTY_COMMANDS, edited)).toEqual(setting([edited]));
  });

  it("drops the stored copy when a default is edited back to its shipped form", () => {
    const stored = setting([{ ...CLEAN, icon: "trash-2" }]);
    expect(saveDraft(stored, { ...CLEAN })).toEqual(EMPTY_COMMANDS);
  });

  it("appends a new command under a fresh custom id", () => {
    const draft = { ...newDraft({ model: "opus", effort: "high" }), name: "Review", prompt: "Review it." };
    const next = saveDraft(setting([custom()]), draft, () => "abcdef");
    expect(next.items.map((c) => c.id)).toEqual(["cmd-111111", "cmd-abcdef"]);
    expect(next.items[1]).toMatchObject({ name: "Review", prompt: "Review it.", icon: "zap" });
  });

  it("never reuses a stored custom id for a new command", () => {
    const ids = ["111111", "222222"];
    const draft = { ...newDraft({ model: "opus", effort: "high" }), name: "Review", prompt: "Review it." };
    const next = saveDraft(setting([custom()]), draft, () => ids.shift()!);
    expect(next.items.map((c) => c.id)).toEqual(["cmd-111111", "cmd-222222"]);
  });

  it("replaces an existing custom command in place, its name trimmed", () => {
    const other = custom({ id: "cmd-222222", name: "Other" });
    const next = saveDraft(setting([custom(), other]), custom({ name: "  Deps 2 " }));
    expect(next.items.map((c) => c.name)).toEqual(["Deps 2", "Other"]);
  });
});

describe("deleteCommand", () => {
  it("records a default as removed", () => {
    expect(deleteCommand(EMPTY_COMMANDS, "clean")).toEqual(setting([], ["clean"]));
  });

  it("drops an edited default's copy as it removes it", () => {
    expect(deleteCommand(setting([{ ...CLEAN, icon: "trash-2" }]), "clean")).toEqual(setting([], ["clean"]));
  });

  it("drops a custom command", () => {
    expect(deleteCommand(setting([custom()]), "cmd-111111")).toEqual(EMPTY_COMMANDS);
  });
});

describe("resetDefault / restoreDefault", () => {
  it("reset drops the stored copy", () => {
    expect(resetDefault(setting([{ ...CLEAN, icon: "trash-2" }, custom()]), "clean")).toEqual(setting([custom()]));
  });

  it("restore empties removed", () => {
    expect(restoreDefault(setting([], ["clean"]), "clean")).toEqual(EMPTY_COMMANDS);
  });
});

describe("restoreBlocked", () => {
  it("blocks a removed default whose name a custom command took", () => {
    expect(restoreBlocked(setting([custom({ name: " clean " })], ["clean"]), "clean")).toBe(true);
  });

  it("lets a removed default back otherwise", () => {
    expect(restoreBlocked(setting([custom()], ["clean"]), "clean")).toBe(false);
  });
});

describe("commandGroups", () => {
  it("puts All projects first, then projects by name, keeping the list's order inside a group", () => {
    const effective = effectiveCommands(
      setting([
        custom({ id: "cmd-000001", name: "B1", project: "beta" }),
        custom({ id: "cmd-000002", name: "G1" }),
        custom({ id: "cmd-000003", name: "A1", project: "Alpha" }),
        custom({ id: "cmd-000004", name: "B2", project: "beta" }),
      ]),
    );
    expect(commandGroups(effective).map((g) => [g.project, g.commands.map((c) => c.name)])).toEqual([
      [null, ["Clean", "G1"]],
      ["Alpha", ["A1"]],
      ["beta", ["B1", "B2"]],
    ]);
  });

  it("omits All projects when no command is global", () => {
    const effective = effectiveCommands(setting([custom({ project: "Web" })], ["clean"]));
    expect(commandGroups(effective).map((g) => g.project)).toEqual(["Web"]);
  });
});

describe("commandTag", () => {
  it("tags a shipped default, an edited one, and no custom command", () => {
    expect(commandTag(EMPTY_COMMANDS, "clean")).toBe("Default");
    expect(commandTag(setting([{ ...CLEAN, icon: "trash-2" }]), "clean")).toBe("Edited");
    expect(commandTag(setting([custom()]), "cmd-111111")).toBeNull();
  });
});

describe("draftError", () => {
  const draft = (over: Partial<CommandDraft> = {}): CommandDraft => ({
    ...newDraft({ model: "opus", effort: "high" }),
    name: "Review",
    prompt: "Review it.",
    ...over,
  });

  it("requires a name and a prompt", () => {
    expect(draftError(EMPTY_COMMANDS, draft({ name: "   " }))).toBe("The name is required.");
    expect(draftError(EMPTY_COMMANDS, draft({ prompt: " \n " }))).toBe("The prompt is required.");
  });

  it("refuses the name of another command in force, ignoring case and spaces", () => {
    expect(draftError(EMPTY_COMMANDS, draft({ name: " clean " }))).toBe("A command named clean already exists.");
    expect(draftError(setting([custom()]), draft({ name: "DEPS" }))).toBe("A command named DEPS already exists.");
  });

  it("lets a command keep its own name", () => {
    expect(draftError(setting([custom()]), custom({ name: "deps" }))).toBeNull();
    expect(draftError(EMPTY_COMMANDS, { ...CLEAN })).toBeNull();
  });

  it("allows the name of a removed default", () => {
    expect(draftError(setting([], ["clean"]), draft({ name: "Clean" }))).toBeNull();
  });

  it("accepts a fine draft", () => {
    expect(draftError(EMPTY_COMMANDS, draft())).toBeNull();
  });
});

describe("importableRows", () => {
  const mk = (id: string, project: string | null): Command => ({
    id,
    name: id,
    prompt: "p",
    icon: "zap",
    project,
    model: "sonnet",
    effort: "high",
  });

  it("enables global commands and ones bound to a mapped project", () => {
    const rows = importableRows([mk("a", null), mk("b", "mojito")], ["mojito"]);
    expect(rows.map((r) => r.disabledReason)).toEqual([null, null]);
  });

  it("disables one bound to a project this instance does not map", () => {
    const rows = importableRows([mk("a", "other")], ["mojito"]);
    expect(rows[0]!.disabledReason).toBe("other is not mapped here");
    expect(rows[0]!.command.id).toBe("a");
  });
});

describe("importErrorMessage", () => {
  it("names a peer with no commands route on 404", () => {
    expect(importErrorMessage("mac", new ApiError(404, "Not found", undefined))).toBe("mac has no commands to import");
  });

  it("passes any other message through", () => {
    expect(importErrorMessage("mac", new ApiError(502, "mac is offline", undefined))).toBe("mac is offline");
    expect(importErrorMessage("mac", new Error("boom"))).toBe("boom");
    expect(importErrorMessage("mac", "x")).toBe("Reading mac's commands failed.");
  });
});

describe("peerCommands", () => {
  const ok = { id: "cmd-abc123", name: "Lint", prompt: "p", icon: "bug", project: null, model: "sonnet", effort: "high" };

  it("answers nothing for a body that is not {commands: [...]}", () => {
    for (const body of [undefined, null, "x", 3, [], {}, { commands: {} }, { commands: "x" }]) {
      expect(peerCommands(body)).toEqual([]);
    }
  });

  it("keeps a valid command", () => {
    expect(peerCommands({ commands: [ok] })).toEqual([ok]);
  });

  it("replaces an unknown icon with zap", () => {
    expect(peerCommands({ commands: [{ ...ok, icon: "sparkles-9000" }] })[0]!.icon).toBe("zap");
    expect(peerCommands({ commands: [{ ...ok, icon: undefined }] })[0]!.icon).toBe("zap");
  });

  it("drops malformed items and odd ids", () => {
    const { name: _n, ...noName } = ok;
    const rows = peerCommands({
      commands: [null, "x", noName, { ...ok, id: "cmd-1", prompt: "x".repeat(20001) }, { ...ok, id: "Bad Id!" }, { ...ok, id: 4 }, ok],
    });
    expect(rows).toEqual([ok]);
  });

  it("keeps the first of a repeated id", () => {
    const rows = peerCommands({ commands: [ok, { ...ok, name: "Other" }] });
    expect(rows.map((c) => c.name)).toEqual(["Lint"]);
  });
});
