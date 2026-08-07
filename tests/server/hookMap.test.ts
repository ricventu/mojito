import { describe, it, expect } from "vitest";
import { mapHook, mapCustomHook } from "@/server/hookMap";

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

  it("stop when ready is done, with a ready-for-QA message", () => {
    const o = mapHook("Stop", true, "running");
    expect(o.state).toBe("done");
    expect(o.alert?.kind).toBe("stage-done");
    expect(o.alert?.message).toBe("ready for QA");
  });

  it("stop with unchanged status means claude is waiting", () => {
    const o = mapHook("Stop", false, "running");
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("session end without a ready-for-qa result is a failure", () => {
    expect(mapHook("SessionEnd", false, "running").state).toBe("failed");
    const o = mapHook("SessionEnd", true, "running");
    expect(o.state).toBe("done");
    expect(o.alert?.message).toBe("ready for QA");
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

describe("mapCustomHook", () => {
  it("a finished turn (Stop) is idle, not needs-input, with no alert", () => {
    const o = mapCustomHook("Stop", "running");
    expect(o.state).toBe("idle");
    expect(o.alert).toBeNull();
  });

  it("an idle Notification is idle, with no alert", () => {
    const o = mapCustomHook("Notification", "running");
    expect(o.state).toBe("idle");
    expect(o.alert).toBeNull();
  });

  it("a permission request still needs input", () => {
    const o = mapCustomHook("PermissionRequest", "idle");
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("an AskUserQuestion (PreToolUse) still needs input", () => {
    const o = mapCustomHook("PreToolUse", "idle");
    expect(o.state).toBe("needs-input");
    expect(o.alert?.kind).toBe("needs-input");
  });

  it("activity (SessionStart / UserPromptSubmit / PostToolUse) is running", () => {
    expect(mapCustomHook("SessionStart", "starting").state).toBe("running");
    expect(mapCustomHook("UserPromptSubmit", "idle").state).toBe("running");
    expect(mapCustomHook("PostToolUse", "idle").state).toBe("running");
  });

  it("a clean SessionEnd is done", () => {
    expect(mapCustomHook("SessionEnd", "idle").state).toBe("done");
  });

  it("a finished (done) session is not dragged back to idle by a late Stop/Notification", () => {
    expect(mapCustomHook("Stop", "done").state).toBe("done");
    expect(mapCustomHook("Notification", "done").state).toBe("done");
  });
});
