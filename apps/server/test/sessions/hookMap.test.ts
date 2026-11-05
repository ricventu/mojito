import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, endReasonFromHook, hookPayload, isHookEvent, isNoiseHook, mapHook } from "../../src/sessions/hookMap";

describe("mapHook", () => {
  it.each([
    ["SessionStart", "running", null],
    ["UserPromptSubmit", "running", null],
    ["PostToolUse", "running", null],
    ["PermissionRequest", "needs-input", "claude is asking for a permission"],
    ["Notification", "needs-input", "claude is waiting for you"],
    ["PreToolUse", "needs-input", "claude is asking you a question"],
    ["Stop", "idle", null],
  ] as const)("%s from running -> %s", (event, state, alert) => {
    expect(mapHook(event, "running")).toEqual({ state, alert });
  });

  it("SessionEnd ends the session, saying whose doing it was", () => {
    expect(mapHook("SessionEnd", "running")).toEqual({ state: "ended", alert: null, endReason: "other" });
    expect(mapHook("SessionEnd", "idle", { reason: "prompt_input_exit" })).toEqual({
      state: "ended",
      alert: null,
      endReason: "exited",
    });
  });

  it("a Stop with a background agent still at work keeps the session running", () => {
    expect(mapHook("Stop", "running", { backgroundAgents: 1 })).toEqual({ state: "running", alert: null });
    expect(mapHook("Stop", "running", { backgroundAgents: 0 })).toEqual({ state: "idle", alert: null });
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

  it("the SessionStart of a /clear leaves the session idle, waiting at an empty prompt", () => {
    expect(mapHook("SessionStart", "running", { source: "clear" })).toEqual({ state: "idle", alert: null });
    expect(mapHook("SessionStart", "idle", { source: "startup" })).toEqual({ state: "running", alert: null });
  });
});

describe("endReasonFromHook", () => {
  it("is the human's doing only for an exit at the prompt or a logout", () => {
    expect(endReasonFromHook("prompt_input_exit")).toBe("exited");
    expect(endReasonFromHook("logout")).toBe("exited");
    expect(endReasonFromHook("other")).toBe("other");
    expect(endReasonFromHook(undefined)).toBe("other");
  });
});

describe("hookPayload background_tasks", () => {
  it("counts the agents still at work, never the shells", () => {
    const body = {
      hook_event_name: "Stop",
      background_tasks: [
        { id: "a", type: "subagent", status: "running", agent_type: "general-purpose" },
        { id: "b", type: "shell", status: "running", command: "php artisan serve" },
        { id: "c", type: "workflow", status: "running" },
        { id: "d", type: "subagent", status: "completed" },
        "junk",
      ],
    };
    expect(hookPayload(body)).toEqual({ backgroundAgents: 2 });
  });

  it("says nothing when claude sends no list, and zero for an empty one", () => {
    expect(hookPayload({ hook_event_name: "Stop" })).toEqual({});
    expect(hookPayload({ background_tasks: [] })).toEqual({ backgroundAgents: 0 });
    expect(hookPayload({ background_tasks: "nope" })).toEqual({});
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
    expect(hookPayload({ hook_event_name: "SessionEnd", session_id: "x", reason: "clear" })).toEqual({
      reason: "clear",
      sessionId: "x",
    });
    expect(hookPayload({ hook_event_name: "Notification", message: "m", notification_type: "idle_prompt" })).toEqual({
      notification_type: "idle_prompt",
    });
    expect(hookPayload({ hook_event_name: "SessionStart", source: "clear" })).toEqual({ source: "clear" });
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
  it("rules out only the SessionEnd of a /clear or a /resume: claude goes on in the same pane", () => {
    expect(isNoiseHook("SessionEnd", { reason: "clear" })).toBe(true);
    expect(isNoiseHook("SessionEnd", { reason: "resume" })).toBe(true);
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
