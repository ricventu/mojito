import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, hookPayload, isHookEvent, isNoiseHook, mapHook } from "../../src/sessions/hookMap";

describe("mapHook", () => {
  it.each([
    ["SessionStart", "running", null],
    ["UserPromptSubmit", "running", null],
    ["PostToolUse", "running", null],
    ["PermissionRequest", "needs-input", "claude is asking for a permission"],
    ["Notification", "needs-input", "claude is waiting for you"],
    ["PreToolUse", "needs-input", "claude is asking you a question"],
    ["Stop", "idle", null],
    ["SessionEnd", "ended", null],
  ] as const)("%s from running -> %s", (event, state, alert) => {
    expect(mapHook(event, "running")).toEqual({ state, alert });
  });

  it("a session that has ended stays ended whatever arrives", () => {
    for (const event of HOOK_EVENTS) expect(mapHook(event, "ended")).toEqual({ state: "ended", alert: null });
  });

  it("an activity signal clears a needs-input alert", () => {
    expect(mapHook("PostToolUse", "needs-input")).toEqual({ state: "running", alert: null });
  });

  it("a late SessionStart takes a stalled launch back to running", () => {
    expect(mapHook("SessionStart", "needs-input")).toEqual({ state: "running", alert: null });
  });
});

describe("isHookEvent", () => {
  it("accepts the eight known events and nothing else", () => {
    expect(HOOK_EVENTS.every(isHookEvent)).toBe(true);
    expect(isHookEvent("Bogus")).toBe(false);
    expect(isHookEvent("")).toBe(false);
  });
});

describe("hookPayload", () => {
  it("reads the fields Mojito uses off claude's hook input", () => {
    expect(hookPayload({ hook_event_name: "SessionEnd", session_id: "x", reason: "clear" })).toEqual({ reason: "clear" });
    expect(hookPayload({ hook_event_name: "Notification", message: "m", notification_type: "idle_prompt" })).toEqual({
      notification_type: "idle_prompt",
    });
  });

  it("is empty for a missing, non-object or mistyped body", () => {
    expect(hookPayload(undefined)).toEqual({});
    expect(hookPayload(null)).toEqual({});
    expect(hookPayload("clear")).toEqual({});
    expect(hookPayload(["clear"])).toEqual({});
    expect(hookPayload({ reason: 1 })).toEqual({});
  });
});

describe("isNoiseHook", () => {
  it("rules out only the SessionEnd of a /clear", () => {
    expect(isNoiseHook("SessionEnd", { reason: "clear" })).toBe(true);
    expect(isNoiseHook("SessionEnd", { reason: "logout" })).toBe(false);
    expect(isNoiseHook("SessionEnd", {})).toBe(false);
    expect(isNoiseHook("Stop", { reason: "clear" })).toBe(false);
  });

  // idle_prompt fires ~60s after every Stop: taken as needs-input, every finished session went amber.
  it.each([
    ["permission_prompt", false],
    ["elicitation_dialog", false],
    ["elicitation_url_dialog", false],
    ["idle_prompt", true],
    ["auth_success", true],
  ])("a %s Notification is noise: %s", (type, noise) => {
    expect(isNoiseHook("Notification", { notification_type: type })).toBe(noise);
  });

  it("keeps a Notification with no type, to be safe", () => {
    expect(isNoiseHook("Notification", {})).toBe(false);
  });
});
