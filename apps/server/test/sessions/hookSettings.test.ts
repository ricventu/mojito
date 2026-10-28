import { describe, expect, it } from "vitest";
import { buildHookSettings } from "../../src/sessions/hookSettings";

type Entry = { matcher?: string; hooks: { type: string; command: string }[] };

describe("buildHookSettings", () => {
  const { hooks } = buildHookSettings("mj-RIC-1", 3100, "tok");

  it("registers every event mapHook reads", () => {
    expect(Object.keys(hooks).sort()).toEqual(
      ["Notification", "PermissionRequest", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"],
    );
  });

  it("scopes PreToolUse to AskUserQuestion and leaves the rest unmatched", () => {
    const pre = hooks.PreToolUse as Entry[];
    expect(pre).toHaveLength(1);
    expect(pre[0].matcher).toBe("AskUserQuestion");
    for (const [event, entries] of Object.entries(hooks)) {
      if (event === "PreToolUse") continue;
      expect((entries as Entry[])[0].matcher).toBeUndefined();
    }
  });

  it("posts to the local hook endpoint with the token and never fails claude", () => {
    const cmd = (hooks.Stop as Entry[])[0].hooks[0];
    expect(cmd.type).toBe("command");
    expect(cmd.command).toContain('"http://127.0.0.1:3100/api/hook?session=mj-RIC-1&event=Stop"');
    expect(cmd.command).toContain("-H 'x-mojito-token: tok'");
    expect(cmd.command.endsWith("|| true")).toBe(true);
  });

  it("escapes an apostrophe in the token and encodes the session id", () => {
    const h = buildHookSettings("mj-a b", 3100, "it's").hooks;
    const cmd = (h.SessionStart as Entry[])[0].hooks[0].command;
    expect(cmd).toContain("-H 'x-mojito-token: it'\\''s'");
    expect(cmd).toContain("session=mj-a%20b&event=SessionStart");
  });
});
