import { describe, it, expect } from "vitest";
import { mapHook } from "@/server/hookMap";

describe("mapHook", () => {
  it("permission request needs input", () => {
    const o = mapHook("PermissionRequest", false);
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("AskUserQuestion (PreToolUse) needs input immediately", () => {
    const o = mapHook("PreToolUse", false);
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("answered question (PostToolUse) returns to running with no alert", () => {
    const o = mapHook("PostToolUse", false);
    expect(o.state).toBe("running");
    expect(o.alert).toBeNull();
  });

  it("stop with advanced status is done", () => {
    const o = mapHook("Stop", true);
    expect(o.state).toBe("done");
    expect(o.alert?.kind).toBe("stage-done");
  });

  it("stop with unchanged status means claude is waiting", () => {
    const o = mapHook("Stop", false);
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("session end without advance is a failure", () => {
    expect(mapHook("SessionEnd", false).state).toBe("failed");
    expect(mapHook("SessionEnd", true).state).toBe("done");
  });
});
