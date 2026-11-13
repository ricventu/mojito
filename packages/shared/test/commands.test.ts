import { describe, expect, it } from "vitest";
import {
  CommandsSettingBody,
  DEFAULT_COMMANDS,
  EMPTY_COMMANDS,
  commandsFor,
  effectiveCommands,
  importCommands,
  isCustomCommandId,
  newCommandId,
  normalizeCommands,
  removeCommandsProject,
  renameCommandsProject,
  type Command,
  type CommandIcon,
} from "../src/index";

const custom = (over: Partial<Command> = {}): Command => ({
  id: "cmd-1a2b3c", name: "Deps", prompt: "Update the dependencies.", icon: "package",
  project: null, model: "sonnet", effort: "high", ...over,
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
  it("commandsFor: global ones and the project's own", () => {
    const web = custom({ id: "cmd-000001", name: "W", project: "Web" });
    const api = custom({ id: "cmd-000002", name: "A", project: "Api" });
    expect(commandsFor([clean, web, api], "Web")).toEqual([clean, web]);
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
});
