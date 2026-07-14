import { describe, it, expect } from "vitest";
import { buildHookSettings } from "@/server/hookSettings";

describe("buildHookSettings", () => {
  const s = buildHookSettings("mojito-RIC-46-planned", 4711, "secret-tok");

  it("defines every hook event, including the resume signals", () => {
    expect(Object.keys(s.hooks).sort()).toEqual(
      ["Notification", "PermissionRequest", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  it("scopes PreToolUse to AskUserQuestion and leaves PostToolUse unmatched (all tools)", () => {
    const pre = s.hooks.PreToolUse as { matcher?: string }[];
    const post = s.hooks.PostToolUse as { matcher?: string }[];
    expect(pre[0].matcher).toBe("AskUserQuestion");
    expect(post[0].matcher).toBeUndefined(); // fires for every finished tool -> running
    expect(JSON.stringify(s.hooks.PreToolUse)).toContain("event=PreToolUse");
    expect(JSON.stringify(s.hooks.PostToolUse)).toContain("event=PostToolUse");
  });

  it("wires UserPromptSubmit as an always-on resume signal", () => {
    const ups = s.hooks.UserPromptSubmit as { matcher?: string }[];
    expect(ups[0].matcher).toBeUndefined();
    expect(JSON.stringify(s.hooks.UserPromptSubmit)).toContain("event=UserPromptSubmit");
  });

  it("each command targets the localhost sink with session and event", () => {
    const stop = JSON.stringify(s.hooks.Stop);
    expect(stop).toContain("127.0.0.1:4711/api/hook");
    expect(stop).toContain("session=mojito-RIC-46-planned");
    expect(stop).toContain("event=Stop");
    expect(stop).toContain("--data-binary @-"); // forwards hook stdin
    expect(stop).toContain("|| true");          // never blocks claude
    expect(stop).toContain("x-mojito-token: secret-tok");
  });
});
