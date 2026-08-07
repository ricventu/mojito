import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleHook } from "@/server/hookHandler";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";

let dir: string;
function seed(over: Partial<SessionMeta> = {}): { registry: Registry; meta: SessionMeta } {
  const registry = new Registry(dir);
  const meta: SessionMeta = { kind: "ticket", id: "mojito-RIC-46-to-code", ticket: "RIC-46", launchStatus: "To Code",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "Some ticket", labels: [], ...over };
  registry.upsert(meta);
  return { registry, meta };
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("handleHook", () => {
  it("permission request flips to needs-input and emits an alert", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-to-code", "PermissionRequest", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("needs-input");
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-to-code", state: "needs-input" });
  });

  it("stop with a stage advance marks done and triggers auto-advance when enabled", async () => {
    const { registry } = seed({ autoAdvance: true });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-to-code", "Stop", {
      registry, bus, getIssueStatus: async () => "To Review", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("done");
    expect(onAutoAdvance).toHaveBeenCalledWith(expect.objectContaining({ ticket: "RIC-46" }), "To Review");
  });

  it("stop on a backward move (QA reject) does NOT advance", async () => {
    // A QA reject sets the ticket back to To Code (a Stage 2 rerun target). A stray
    // Stop from the To QA session must not be read as a completed stage and relaunch.
    const { registry } = seed({ autoAdvance: true, id: "mojito-RIC-46-to-qa", launchStatus: "To QA" });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-to-qa", "Stop", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance,
    });
    expect(registry.get("mojito-RIC-46-to-qa")?.state).not.toBe("done");
    expect(onAutoAdvance).not.toHaveBeenCalled();
  });

  it("stop with unchanged status is needs-input (claude asked something)", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-to-code", "Stop", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("needs-input");
  });

  it("ignores an unknown session id", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("nope", "Stop", { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    // no throw, nothing emitted
    expect(registry.get("nope")).toBeUndefined();
  });

  it("UserPromptSubmit clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude is waiting for you" });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-to-code", "UserPromptSubmit", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    const m = registry.get("mojito-RIC-46-to-code");
    expect(m?.state).toBe("running");
    expect(m?.message).toBeUndefined();
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-to-code", state: "running" });
  });

  it("PostToolUse (any tool) clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude needs your attention" });
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-to-code", "PostToolUse", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("running");
  });

  it("an idle Notification does NOT resurrect a finished (done) session (RIC-117)", async () => {
    // The reported bug: a session finishes its stage (done), then Claude Code fires an
    // idle Notification ~60s later. Before the fix that flipped the badge back to
    // needs-input and it stuck forever. A finished session must stay done.
    const { registry } = seed({ state: "done", message: "stage complete" });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-to-code", "Notification", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {},
    });
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("done");
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "session.state", state: "needs-input" }),
    );
  });

  it("an idle Notification on a finished session never re-triggers auto-advance (RIC-117)", async () => {
    // Auto-advance must fire only on a genuine stage-completing Stop/SessionEnd, never on a
    // passive event that merely preserves an already-done state. Notification does not
    // re-fetch the status, so the stale launchStatus (To Code) would otherwise be read as a
    // fresh handoff and relaunch a duplicate stage.
    const { registry } = seed({ state: "done", autoAdvance: true, launchStatus: "To Code" });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    await handleHook("mojito-RIC-46-to-code", "Notification", {
      registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance,
    });
    expect(onAutoAdvance).not.toHaveBeenCalled();
    expect(registry.get("mojito-RIC-46-to-code")?.state).toBe("done");
  });
});

function seedCustom(over: Partial<SessionMeta> = {}): Registry {
  const registry = new Registry(dir);
  registry.upsert({ kind: "custom", id: "mojito-custom-general-abc", ticket: "", launchStatus: "",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/home/me",
    createdAt: "2026-07-11T00:00:00.000Z", title: "home", labels: [], ...over });
  return registry;
}

describe("handleHook — custom sessions", () => {
  it("patches the title from session_title without calling Linear", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const getIssueStatus = vi.fn(async () => "unused");
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, getIssueStatus, onAutoAdvance: () => {} },
      { sessionTitle: "refactor auth flow" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("refactor auth flow");
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("running");
    expect(getIssueStatus).not.toHaveBeenCalled();
  });

  it("SessionEnd on a custom session is done, not failed", async () => {
    // launchStatus/getIssueStatus are chosen so that, on the lime fall-through path,
    // stageAdvanced("To Code", "To Code") would be false, and mapHook("SessionEnd", false)
    // maps to "failed" — not "done". A "done" result here can only come from the
    // custom branch's unconditional done-on-SessionEnd override, so this fails if that
    // branch is deleted.
    const registry = seedCustom({ launchStatus: "To Code" });
    const bus = new EventBus();
    const getIssueStatus = vi.fn(async () => "To Code");
    await handleHook("mojito-custom-general-abc", "SessionEnd",
      { registry, bus, getIssueStatus, onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("done");
    expect(getIssueStatus).not.toHaveBeenCalled();
  });

  it("never auto-advances a custom session", async () => {
    // autoAdvance is on AND the mocked status is a genuine stage handoff
    // (To Code -> To Review, so stageAdvanced is true) — on the lime fall-through path
    // this combination would map SessionEnd to "done" and then call onAutoAdvance.
    // onAutoAdvance NOT being called here proves the custom branch suppresses
    // auto-advance itself, rather than merely inheriting a false autoAdvance flag.
    const registry = seedCustom({ autoAdvance: true, launchStatus: "To Code" });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    const getIssueStatus = vi.fn(async () => "To Review");
    await handleHook("mojito-custom-general-abc", "SessionEnd",
      { registry, bus, getIssueStatus, onAutoAdvance });
    expect(onAutoAdvance).not.toHaveBeenCalled();
    expect(getIssueStatus).not.toHaveBeenCalled();
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("done");
  });

  it("keeps an empty session_title from clobbering the fallback label", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const getIssueStatus = vi.fn(async () => "x");
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, getIssueStatus, onAutoAdvance: () => {} },
      { sessionTitle: "" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("home");
    expect(getIssueStatus).not.toHaveBeenCalled();
  });

  it("labels the session from Claude Code's transcript title on a Stop hook", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => "Cosmetic spray base inquiry response");
    await handleHook("mojito-custom-general-abc", "Stop",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {}, readTranscriptTitle },
      { transcriptPath: "/some/transcript.jsonl" });
    expect(readTranscriptTitle).toHaveBeenCalledWith("/some/transcript.jsonl");
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("Cosmetic spray base inquiry response");
  });

  it("prefers an explicit session_title over the transcript title", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => "Auto guessed title");
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {}, readTranscriptTitle },
      { sessionTitle: "renamed by user", transcriptPath: "/some/transcript.jsonl" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("renamed by user");
    expect(readTranscriptTitle).not.toHaveBeenCalled();
  });

  it("does not read the transcript on the high-frequency PostToolUse hook", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => "Should not be read");
    await handleHook("mojito-custom-general-abc", "PostToolUse",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {}, readTranscriptTitle },
      { transcriptPath: "/some/transcript.jsonl" });
    expect(readTranscriptTitle).not.toHaveBeenCalled();
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("home");
  });

  it("keeps the fallback label when the transcript has no title yet", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => null);
    await handleHook("mojito-custom-general-abc", "Stop",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {}, readTranscriptTitle },
      { transcriptPath: "/some/transcript.jsonl" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("home");
  });

  it("Stop on a custom session is idle (waiting), not needs-input, and emits no alert", async () => {
    // A custom session is an interactive terminal: after each turn it rests waiting for the
    // user. That's the calm "idle" state, not the amber needs-input alert (RIC "always
    // needs input"). needs-input is reserved for a genuine block (permission / question).
    const registry = seedCustom();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-custom-general-abc", "Stop",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("idle");
    expect(events).not.toContainEqual(expect.objectContaining({ type: "session.alert" }));
  });

  it("an idle Notification on a custom session is idle, not needs-input", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "Notification",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("idle");
  });

  it("a custom session still needs input for a permission request", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-custom-general-abc", "PermissionRequest",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("needs-input");
    expect(events).toContainEqual(expect.objectContaining({ type: "session.alert", kind: "needs-input" }));
  });

  it("a custom session still needs input when claude asks a question (PreToolUse)", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "PreToolUse",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("needs-input");
  });

  it("PostToolUse revives a custom session from idle back to running", async () => {
    const registry = seedCustom({ state: "idle" });
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "PostToolUse",
      { registry, bus, getIssueStatus: async () => "x", onAutoAdvance: () => {} });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("running");
  });
});

function seedRebase(over: Partial<SessionMeta> = {}): Registry {
  const registry = new Registry(dir);
  registry.upsert({ kind: "rebase", id: "mojito-rebase-RIC-46", ticket: "RIC-46", launchStatus: "To QA",
    model: "opus", effort: "high", autoAdvance: false, state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "Rebase RIC-46", labels: [], ...over });
  return registry;
}

describe("handleHook — rebase sessions", () => {
  it("SessionEnd on a rebase session is done, not failed, and never calls Linear", async () => {
    // A rebase session stays at To QA (or escalates backward to To Code) by design, so on
    // the lime fall-through path getIssueStatus would return a non-advanced status and
    // stageAdvanced would always be false, mapping SessionEnd to "failed". A clean rebase
    // must land on "done" instead, without ever reading Linear.
    const registry = seedRebase();
    const bus = new EventBus();
    const getIssueStatus = vi.fn(async () => "To QA");
    await handleHook("mojito-rebase-RIC-46", "SessionEnd",
      { registry, bus, getIssueStatus, onAutoAdvance: () => {} });
    expect(registry.get("mojito-rebase-RIC-46")?.state).toBe("done");
    expect(getIssueStatus).not.toHaveBeenCalled();
  });

  it("Stop on a rebase session with a genuine prompt still maps to needs-input", async () => {
    const registry = seedRebase();
    const bus = new EventBus();
    const getIssueStatus = vi.fn(async () => "To QA");
    await handleHook("mojito-rebase-RIC-46", "Stop",
      { registry, bus, getIssueStatus, onAutoAdvance: () => {} });
    expect(registry.get("mojito-rebase-RIC-46")?.state).toBe("needs-input");
    expect(getIssueStatus).not.toHaveBeenCalled();
  });

  it("never auto-advances a rebase session even when autoAdvance is enabled", async () => {
    const registry = seedRebase({ autoAdvance: true });
    const bus = new EventBus();
    const onAutoAdvance = vi.fn();
    const getIssueStatus = vi.fn(async () => "To Merge");
    await handleHook("mojito-rebase-RIC-46", "SessionEnd",
      { registry, bus, getIssueStatus, onAutoAdvance });
    expect(onAutoAdvance).not.toHaveBeenCalled();
    expect(getIssueStatus).not.toHaveBeenCalled();
    expect(registry.get("mojito-rebase-RIC-46")?.state).toBe("done");
  });

  it("a rebase alert carries the real ticket, not an empty string", async () => {
    const registry = seedRebase();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-rebase-RIC-46", "PermissionRequest",
      { registry, bus, getIssueStatus: async () => "To QA", onAutoAdvance: () => {} });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "session.alert", ticket: "RIC-46" }),
    );
  });
});

it("does not overwrite a lime session's title", async () => {
  const { registry } = seed({ title: "Linear title" });
  const bus = new EventBus();
  await handleHook("mojito-RIC-46-to-code", "SessionStart",
    { registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {} },
    { sessionTitle: "should be ignored" });
  expect(registry.get("mojito-RIC-46-to-code")?.title).toBe("Linear title");
});

it("never reads the transcript title for a lime session", async () => {
  const { registry } = seed({ title: "Linear title" });
  const bus = new EventBus();
  const readTranscriptTitle = vi.fn(() => "auto title");
  await handleHook("mojito-RIC-46-to-code", "Stop",
    { registry, bus, getIssueStatus: async () => "To Code", onAutoAdvance: () => {}, readTranscriptTitle },
    { transcriptPath: "/some/transcript.jsonl" });
  expect(readTranscriptTitle).not.toHaveBeenCalled();
  expect(registry.get("mojito-RIC-46-to-code")?.title).toBe("Linear title");
});
