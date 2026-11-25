import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_PROMPT_MAX,
  CommandRunBody,
  CommandSchema,
  CommandsSettingBody,
  DEFAULT_COMMANDS,
  EMPTY_COMMANDS,
  commandsFor,
  effectiveCommands,
  importCommands,
  isCustomCommandId,
  isRunnableCommandId,
  newCommandId,
  normalizeCommands,
  readCommandsSetting,
  removeCommandsProject,
  renameCommandsProject,
  type Command,
  type CommandIcon,
} from "../src/index";

const custom = (over: Partial<Command> = {}): Command => ({
  id: "cmd-1a2b3c", name: "Deps", prompt: "Update the dependencies.", icon: "package",
  project: null, excluded: [], model: "sonnet", effort: "high", worktree: false, ...over,
});
const clean = DEFAULT_COMMANDS[0];

describe("commands", () => {
  it("effectiveCommands: nothing stored answers the defaults", () =>
    expect(effectiveCommands(EMPTY_COMMANDS)).toEqual([clean]));
  it("effectiveCommands: an edited default replaces it in place, customs follow in stored order", () => {
    const edited = { ...clean, model: "opus" as const };
    const b = custom({ id: "cmd-bbbbbb", name: "B" });
    expect(effectiveCommands({ items: [b, edited, custom()], removed: [] })).toEqual([edited, b, custom()]);
  });
  it("effectiveCommands: a removed default is left out", () =>
    expect(effectiveCommands({ items: [], removed: ["clean"] })).toEqual([]));
  it("effectiveCommands hides a default shadowed by a custom name", () =>
    expect(effectiveCommands({ items: [custom({ name: "clean" })], removed: [] }).map((c) => c.id)).toEqual(["cmd-1a2b3c"]));
  it("effectiveCommands never hides an edited default by name: renamed Tidy and a custom Clean are both in force", () => {
    const tidy = { ...clean, name: "Tidy" };
    const mine = custom({ id: "cmd-abcdef", name: "Clean", icon: "zap" });
    const s = { items: [tidy, mine], removed: [] };
    expect(effectiveCommands(s).map((c) => c.name)).toEqual(["Tidy", "Clean"]);
    expect(CommandsSettingBody.safeParse(s).success).toBe(true);
    // A custom Tidy beside the edited Tidy is still a clash in force.
    expect(CommandsSettingBody.safeParse({ items: [tidy, custom({ name: "tidy" })], removed: [] }).success).toBe(false);
    // An edited default that keeps its shipped name is not hidden either: two Cleans in force are refused.
    expect(effectiveCommands({ items: [{ ...clean, model: "opus" as const }, mine], removed: [] }).map((c) => c.id)).toEqual(["clean", "cmd-abcdef"]);
    expect(CommandsSettingBody.safeParse({ items: [{ ...clean, model: "opus" as const }, mine], removed: [] }).success).toBe(false);
  });
  it("importCommands of a custom Clean keeps a renamed Clean in force", () => {
    const tidy = { ...clean, name: "Tidy" };
    const mine = custom({ id: "cmd-abcdef", name: "Clean" });
    expect(effectiveCommands(importCommands({ items: [tidy], removed: [] }, [mine])).map((c) => c.name)).toEqual(["Tidy", "Clean"]);
  });
  it("default ids are plain words, unique, and never git (the git-resolve session's suffix)", () => {
    const ids = DEFAULT_COMMANDS.map((c) => c.id);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    expect(ids).not.toContain("git");
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("EMPTY_COMMANDS is frozen, arrays too", () => {
    expect(Object.isFrozen(EMPTY_COMMANDS)).toBe(true);
    expect(Object.isFrozen(EMPTY_COMMANDS.items)).toBe(true);
    expect(Object.isFrozen(EMPTY_COMMANDS.removed)).toBe(true);
  });
  it("a prompt is capped at COMMAND_PROMPT_MAX (8000: tmux refuses a longer argv)", () => {
    expect(COMMAND_PROMPT_MAX).toBe(8000);
    expect(CommandSchema.safeParse(custom({ prompt: "x".repeat(8000) })).success).toBe(true);
    expect(CommandSchema.safeParse(custom({ prompt: "x".repeat(8001) })).success).toBe(false);
  });
  it("commandsFor: global ones and the project's own", () => {
    const web = custom({ id: "cmd-000001", name: "W", project: "Web" });
    const api = custom({ id: "cmd-000002", name: "A", project: "Api" });
    expect(commandsFor([clean, web, api], "Web")).toEqual([clean, web]);
  });
  it("commandsFor: a general command is not offered on a project it excludes", () => {
    const deps = custom({ excluded: ["Api"] });
    expect(commandsFor([deps], "Api")).toEqual([]);
    expect(commandsFor([deps], "Web")).toEqual([deps]);
    // A project's own command ignores excluded (it is always [] once parsed anyway).
    expect(commandsFor([custom({ project: "Api", excluded: ["Api"] })], "Api")).toHaveLength(1);
  });
  describe("CommandSchema: excluded", () => {
    const parse = (raw: unknown) => CommandSchema.parse(raw);
    it("defaults to [] (a stored command or an older peer's has none)", () => {
      const { excluded: _, ...old } = custom();
      expect(parse(old).excluded).toEqual([]);
    });
    it("is deduplicated and sorted with plain sort", () =>
      expect(parse(custom({ excluded: ["web", "Api", "web", "Zed"] })).excluded).toEqual(["Api", "Zed", "web"]));
    it("is emptied for a project's own command", () =>
      expect(parse(custom({ project: "Web", excluded: ["Api"] })).excluded).toEqual([]));
    it("refuses an empty name and more than 100 names", () => {
      expect(CommandSchema.safeParse(custom({ excluded: [""] })).success).toBe(false);
      expect(CommandSchema.safeParse(custom({ excluded: Array.from({ length: 101 }, (_, i) => `p${i}`) })).success).toBe(false);
    });
    it("readCommandsSetting keeps it, canonical", () =>
      expect(readCommandsSetting({ items: [custom({ excluded: ["b", "a"] })], removed: [] }).items[0]!.excluded).toEqual(["a", "b"]));
  });
  it("normalizeCommands: Clean with an exclusion is an edit, without one it is the default again", () => {
    expect(normalizeCommands({ items: [{ ...clean, excluded: ["Web"] }], removed: [] }).items).toHaveLength(1);
    expect(normalizeCommands({ items: [{ ...clean, excluded: [] }], removed: [] }).items).toEqual([]);
  });
  it("normalizeCommands drops an item equal to its default and stray removed ids", () =>
    expect(normalizeCommands({ items: [{ ...clean }], removed: ["nope", "clean"] })).toEqual({ items: [], removed: ["clean"] }));
  it("normalizeCommands: an edited default un-removes it", () =>
    expect(normalizeCommands({ items: [{ ...clean, name: "Sweep" }], removed: ["clean"] }).removed).toEqual([]));
  it("CommandsSettingBody refuses an id outside both namespaces, an unknown default id, a duplicate effective name, an unknown icon", () => {
    const bad = (items: Command[]) => CommandsSettingBody.safeParse({ items, removed: [] }).success;
    expect(bad([custom({ id: "deps" })])).toBe(false); // looks like a default, ships none
    expect(bad([custom({ id: "cmd-XYZ" })])).toBe(false);
    expect(bad([custom({ id: "cmd-1a2b3c", name: "Deps" }), custom({ id: "cmd-2b3c4d", name: " deps " })])).toBe(false);
    expect(bad([custom({ icon: "skull" as CommandIcon })])).toBe(false);
    expect(bad([custom()])).toBe(true);
    expect(bad([custom({ name: " Clean " })])).toBe(true); // shadows the default, which is hidden
    expect(CommandsSettingBody.safeParse({ items: [custom({ name: "Clean" })], removed: ["clean"] }).success).toBe(true);
  });
  it("newCommandId has the custom shape", () => expect(isCustomCommandId(newCommandId())).toBe(true));
  it("renameCommandsProject / removeCommandsProject", () => {
    const web = custom({ project: "Web" });
    const cleanWeb = { ...clean, project: "Web" };
    expect(renameCommandsProject({ items: [web, cleanWeb], removed: [] }, "Web", "Site").items.map((c) => c.project)).toEqual(["Site", "Site"]);
    expect(removeCommandsProject({ items: [web, cleanWeb, custom({ id: "cmd-999999", name: "G" })], removed: [] }, "Web"))
      .toEqual({ items: [custom({ id: "cmd-999999", name: "G" })], removed: [] });
  });
  it("renameCommandsProject renames it inside excluded; removeCommandsProject drops it there", () => {
    const deps = custom({ excluded: ["Api", "Web"] });
    expect(renameCommandsProject({ items: [deps], removed: [] }, "Web", "Site").items[0]!.excluded).toEqual(["Api", "Site"]);
    expect(renameCommandsProject({ items: [deps], removed: [] }, "Web", "Aaa").items[0]!.excluded).toEqual(["Aaa", "Api"]);
    expect(removeCommandsProject({ items: [deps], removed: [] }, "Web").items[0]!.excluded).toEqual(["Api"]);
    // Clean edited only to skip Web is the default again once Web is gone.
    expect(removeCommandsProject({ items: [{ ...clean, excluded: ["Web"] }], removed: [] }, "Web")).toEqual(EMPTY_COMMANDS);
  });
  describe("importCommands", () => {
    it("same id replaces", () => {
      const local = { items: [custom()], removed: [] };
      expect(importCommands(local, [custom({ prompt: "New." })]).items).toEqual([custom({ prompt: "New." })]);
    });
    it("same name keeps the local id; a local default matched by name becomes its edited copy", () => {
      const local = { items: [custom()], removed: [] };
      expect(importCommands(local, [custom({ id: "cmd-ffffff", name: "deps", prompt: "X" })]).items)
        .toEqual([custom({ name: "deps", prompt: "X" })]);
      expect(importCommands(EMPTY_COMMANDS, [custom({ id: "cmd-ffffff", name: "Clean", prompt: "X" })]).items)
        .toEqual([{ ...custom({ name: "Clean", prompt: "X" }), id: "clean" }]);
    });
    it("no match adds; an unknown default id gets a fresh cmd- id; equal default stores nothing; removed default is un-removed", () => {
      expect(importCommands(EMPTY_COMMANDS, [custom()]).items).toEqual([custom()]);
      const fresh = importCommands(EMPTY_COMMANDS, [custom({ id: "deploy", name: "Deploy" })], () => "abcdef");
      expect(fresh.items[0].id).toBe("cmd-abcdef");
      expect(importCommands({ items: [], removed: ["clean"] }, [clean])).toEqual(EMPTY_COMMANDS);
    });
  });
  describe("readCommandsSetting", () => {
    const warn = () => vi.fn<(message: string) => void>();
    it("reads a valid setting as stored, normalized", () => {
      const w = warn();
      expect(readCommandsSetting({ items: [custom(), { ...clean }], removed: ["clean"] }, w)).toEqual({ items: [custom()], removed: ["clean"] });
      expect(w).not.toHaveBeenCalled();
    });
    it("an unknown icon becomes zap", () =>
      expect(readCommandsSetting({ items: [{ ...custom(), icon: "skull" }], removed: [] }).items[0]!.icon).toBe("zap"));
    it("one bad item is dropped, the others survive, with one warning", () => {
      const w = warn();
      const items = [
        custom(),
        { ...custom({ id: "cmd-222222", name: "Long" }), prompt: "x".repeat(COMMAND_PROMPT_MAX + 1) },
        custom({ id: "deploy", name: "Deploy" }), // no such default
        "x",
        custom({ id: "cmd-333333", name: "Lint" }),
      ];
      expect(readCommandsSetting({ items, removed: [] }, w).items.map((c) => c.id)).toEqual(["cmd-1a2b3c", "cmd-333333"]);
      expect(w).toHaveBeenCalledTimes(1);
    });
    it("a repeated id keeps the first; a repeated name drops the later item", () => {
      const items = [custom(), custom({ name: "Other" }), custom({ id: "cmd-444444", name: " DEPS " }), custom({ id: "cmd-555555", name: "Five" })];
      expect(readCommandsSetting({ items, removed: [] }).items.map((c) => c.id)).toEqual(["cmd-1a2b3c", "cmd-555555"]);
    });
    it("removed keeps only strings (then normalized)", () =>
      expect(readCommandsSetting({ items: [], removed: ["clean", 3, null, "nope"] }).removed).toEqual(["clean"]));
    it("a whole-garbage value is empty, with one warning", () => {
      for (const raw of [null, "x", 3, [], {}, { items: "x", removed: [] }, { items: [], removed: {} }]) {
        const w = warn();
        expect(readCommandsSetting(raw, w)).toEqual(EMPTY_COMMANDS);
        expect(w).toHaveBeenCalledTimes(1);
      }
    });
  });
});

describe("worktree (RIC-622)", () => {
  it("CommandSchema reads a command with no worktree as off, and keeps one that has it", () => {
    const { worktree: _, ...old } = custom();
    expect(CommandSchema.parse(old).worktree).toBe(false);
    expect(CommandSchema.parse(custom({ worktree: true })).worktree).toBe(true);
  });
  it("Clean ships with it off", () => expect(clean.worktree).toBe(false));
  it("normalizeCommands stores a default edited only in its worktree", () => {
    const edited = { ...clean, worktree: true };
    expect(normalizeCommands({ items: [edited], removed: [] }).items).toEqual([edited]);
  });
});

describe("CommandRunBody", () => {
  const body = { prompt: "Do it.", model: "opus", effort: "high", worktree: true };
  it("takes a prompt and the run's options", () => expect(CommandRunBody.parse(body)).toEqual(body));
  it("refuses an empty or oversized prompt", () => {
    expect(CommandRunBody.safeParse({ ...body, prompt: "" }).success).toBe(false);
    expect(CommandRunBody.safeParse({ ...body, prompt: "x".repeat(COMMAND_PROMPT_MAX + 1) }).success).toBe(false);
  });
  it("needs every option", () => {
    expect(CommandRunBody.safeParse({ prompt: "Do it." }).success).toBe(false);
    expect(CommandRunBody.safeParse({ ...body, model: "gpt" }).success).toBe(false);
  });
});

describe("isRunnableCommandId", () => {
  it("takes a plain word and a custom id", () => {
    expect(isRunnableCommandId("clean")).toBe(true);
    expect(isRunnableCommandId("cmd-a1b2c3")).toBe(true);
  });
  it("refuses anything that could reach a session id unsafely", () => {
    for (const id of ["", "Clean", "cmd-xyz", "a b", "a;b", "cmd-a1b2c3-x", "../x"]) expect(isRunnableCommandId(id)).toBe(false);
  });
});
