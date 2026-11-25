import { COMMAND_PROMPT_MAX, DEFAULT_COMMANDS, EMPTY_COMMANDS, effectiveCommands, type Command, type CommandsSetting } from "@mojito/shared";
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
  copyName,
  duplicateDraft,
  skipOptions,
  excludedNote,
  saveDraft,
  toggleExcluded,
  type CommandDraft,
} from "../../src/lib/commandForm";

const CLEAN = DEFAULT_COMMANDS.find((c) => c.id === "clean")!;

const custom = (over: Partial<Command> = {}): Command => ({
  id: "cmd-111111",
  name: "Deps",
  prompt: "Update the dependencies.",
  icon: "package",
  project: null,
  excluded: [],
  model: "sonnet",
  effort: "medium",
  worktree: false,
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
      excluded: [],
      model: "opus",
      effort: "xhigh",
      worktree: false,
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

  it("stores excluded canonical, and empty for a project's own command", () => {
    expect(saveDraft(EMPTY_COMMANDS, { ...custom(), excluded: ["Web", "Api", "Web"] }).items[0]!.excluded).toEqual(["Api", "Web"]);
    expect(saveDraft(EMPTY_COMMANDS, { ...custom(), project: "Web", excluded: ["Api"] }).items[0]!.excluded).toEqual([]);
  });

  it("an exclusion on Clean is an edit; unticked again, Clean is the default", () => {
    const skipped = saveDraft(EMPTY_COMMANDS, { ...CLEAN, excluded: ["Web"] });
    expect(skipped.items).toEqual([{ ...CLEAN, excluded: ["Web"] }]);
    expect(saveDraft(skipped, { ...CLEAN, excluded: [] })).toEqual(EMPTY_COMMANDS);
  });
});

describe("copyName", () => {
  it("adds copy, then numbers it while the name is taken (any case)", () => {
    expect(copyName([custom()], "Deps")).toBe("Deps copy");
    expect(copyName([custom(), custom({ id: "cmd-2", name: "deps COPY" })], "Deps")).toBe("Deps copy 2");
    expect(copyName([custom({ name: "Deps copy" }), custom({ id: "cmd-2", name: "Deps copy 2" })], "Deps")).toBe("Deps copy 3");
  });

  it("clips the name so the copy fits in 40 characters", () => {
    const long = "x".repeat(40);
    expect(copyName([], long)).toBe(`${"x".repeat(35)} copy`);
    expect(copyName([custom({ name: `${"x".repeat(35)} copy` })], long)).toBe(`${"x".repeat(33)} copy 2`);
  });

  it("trims the name first", () => expect(copyName([], "  Deps ")).toBe("Deps copy"));
});

describe("duplicateDraft", () => {
  it("is a new command with the form's fields and a free copy name", () => {
    const draft: CommandDraft = { ...custom({ excluded: ["Api"] }), prompt: "edited, unsaved" };
    expect(duplicateDraft(setting([custom()]), draft)).toEqual({ ...draft, id: null, name: "Deps copy" });
  });

  it("copies a default as a custom command", () => {
    const copy = duplicateDraft(EMPTY_COMMANDS, { ...CLEAN });
    expect(copy).toMatchObject({ id: null, name: "Clean copy", prompt: CLEAN.prompt });
    const saved = saveDraft(EMPTY_COMMANDS, copy, () => "abcdef");
    expect(effectiveCommands(saved).map((c) => c.id)).toEqual(["clean", "cmd-abcdef"]);
  });
});

describe("excluded in the form", () => {
  it("skipOptions: the mapped projects not skipped yet, by name", () =>
    expect(skipOptions(["web", "Zed", "Api"], ["Gone", "Api"])).toEqual(["web", "Zed"]));

  it("toggleExcluded adds and removes a name, kept canonical", () => {
    expect(toggleExcluded(["Web"], "Api", true)).toEqual(["Api", "Web"]);
    expect(toggleExcluded(["Api", "Web"], "Api", false)).toEqual(["Web"]);
    expect(toggleExcluded(["Api"], "Api", true)).toEqual(["Api"]);
  });

  it("excludedNote names the skipped projects of a general command only", () => {
    expect(excludedNote(custom({ excluded: ["Api", "Web"] }))).toBe("Not on Api, Web");
    expect(excludedNote(custom())).toBeNull();
    expect(excludedNote(custom({ project: "Web", excluded: ["Api"] }))).toBeNull();
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

  it("agrees with effectiveCommands: blocked exactly when the restored default would stay hidden", () => {
    const cases = [
      setting([custom({ name: "Clean" })], ["clean"]),
      setting([custom({ name: "Tidy" })], ["clean"]),
      setting([custom()], ["clean"]),
      setting([], ["clean"]),
    ];
    for (const s of cases) {
      const hidden = !effectiveCommands(restoreDefault(s, "clean")).some((c) => c.id === "clean");
      expect(restoreBlocked(s, "clean")).toBe(hidden);
    }
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

  it("a custom Clean beside a renamed Clean keeps both in force; a second Tidy is refused", () => {
    const s = setting([{ ...CLEAN, name: "Tidy" }]);
    expect(draftError(s, draft({ name: "Clean" }))).toBeNull();
    const saved = saveDraft(s, draft({ name: "Clean" }), () => "abcdef");
    expect(effectiveCommands(saved).map((c) => c.name)).toEqual(["Tidy", "Clean"]);
    expect(draftError(s, draft({ name: "tidy" }))).toBe("A command named tidy already exists.");
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
    excluded: [],
    model: "sonnet",
    effort: "high",
    worktree: false,
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
  const ok = { id: "cmd-abc123", name: "Lint", prompt: "p", icon: "bug", project: null, excluded: ["Api"], model: "sonnet", effort: "high", worktree: true };

  it("reads an older peer's command, which has no worktree, as off", () => {
    const { worktree: _w, ...older } = ok;
    expect(peerCommands({ commands: [older] })).toEqual([{ ...ok, worktree: false }]);
  });

  it("answers nothing for a body that is not {commands: [...]}", () => {
    for (const body of [undefined, null, "x", 3, [], {}, { commands: {} }, { commands: "x" }]) {
      expect(peerCommands(body)).toEqual([]);
    }
  });

  it("keeps a valid command", () => {
    expect(peerCommands({ commands: [ok] })).toEqual([ok]);
  });

  it("reads an older peer's command, which has no excluded, as excluding nothing", () => {
    const { excluded: _e, ...older } = ok;
    expect(peerCommands({ commands: [older] })).toEqual([{ ...ok, excluded: [] }]);
  });

  it("replaces an unknown icon with zap", () => {
    expect(peerCommands({ commands: [{ ...ok, icon: "sparkles-9000" }] })[0]!.icon).toBe("zap");
    expect(peerCommands({ commands: [{ ...ok, icon: undefined }] })[0]!.icon).toBe("zap");
  });

  it("drops malformed items and odd ids", () => {
    const { name: _n, ...noName } = ok;
    const rows = peerCommands({
      commands: [null, "x", noName, { ...ok, id: "cmd-1", prompt: "x".repeat(COMMAND_PROMPT_MAX + 1) }, { ...ok, id: "Bad Id!" }, { ...ok, id: 4 }, ok],
    });
    expect(rows).toEqual([ok]);
  });

  it("keeps the first of a repeated id", () => {
    const rows = peerCommands({ commands: [ok, { ...ok, name: "Other" }] });
    expect(rows.map((c) => c.name)).toEqual(["Lint"]);
  });
});
