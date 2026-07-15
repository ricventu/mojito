import { describe, it, expect } from "vitest";
import { mapHook } from "@/server/hookMap";

describe("mapHook", () => {
  it("session start moves out of starting into running with no alert", () => {
    const o = mapHook("SessionStart", false, "starting");
    expect(o.state).toBe("running");
    expect(o.alert).toBeNull();
  });

  it("permission request needs input", () => {
    const o = mapHook("PermissionRequest", false, "running");
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("AskUserQuestion (PreToolUse) needs input immediately", () => {
    const o = mapHook("PreToolUse", false, "running");
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("answered question (PostToolUse) returns to running with no alert", () => {
    const o = mapHook("PostToolUse", false, "needs-input");
    expect(o.state).toBe("running");
    expect(o.alert).toBeNull();
  });

  it("user prompt submit returns to running with no alert", () => {
    const o = mapHook("UserPromptSubmit", false, "needs-input");
    expect(o.state).toBe("running");
    expect(o.alert).toBeNull();
  });

  it("stop with advanced status is done", () => {
    const o = mapHook("Stop", true, "running");
    expect(o.state).toBe("done");
    expect(o.alert?.kind).toBe("stage-done");
  });

  it("stop with unchanged status means claude is waiting", () => {
    const o = mapHook("Stop", false, "running");
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("session end without advance is a failure", () => {
    expect(mapHook("SessionEnd", false, "running").state).toBe("failed");
    expect(mapHook("SessionEnd", true, "running").state).toBe("done");
  });

  // RIC-117 follow-up: terminal states (done/failed) are sticky against passive idle
  // signals. Claude Code fires an idle Notification ~60s after a turn ends; once a session
  // has finished its stage, that ping must NOT drag it back to needs-input — nothing would
  // ever clear it (no further PostToolUse/UserPromptSubmit arrive), so the badge sticks.
  it("idle Notification does not resurrect a finished (done) session", () => {
    const o = mapHook("Notification", false, "done");
    expect(o.state).toBe("done");
    expect(o.alert).toBeNull();
  });

  it("idle Notification does not resurrect a finished (failed) session", () => {
    const o = mapHook("Notification", false, "failed");
    expect(o.state).toBe("failed");
    expect(o.alert).toBeNull();
  });

  it("a late permission request does not override a finished (done) session", () => {
    expect(mapHook("PermissionRequest", false, "done").state).toBe("done");
  });

  // But genuine activity still revives a finished session — the user may reuse a done
  // session by typing a new prompt, or a stray tool completes.
  it("a submitted prompt revives a finished (done) session to running", () => {
    const o = mapHook("UserPromptSubmit", false, "done");
    expect(o.state).toBe("running");
    expect(o.alert).toBeNull();
  });

  it("a finished tool call revives a finished (done) session to running", () => {
    expect(mapHook("PostToolUse", false, "done").state).toBe("running");
  });
});
