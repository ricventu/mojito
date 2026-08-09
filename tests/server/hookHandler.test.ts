import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleHook } from "@/server/hookHandler";
import { Registry } from "@/server/registry";
import { EventBus } from "@/server/events";
import type { SessionMeta } from "@/server/types";
import type { SessionResult } from "@/server/sessionResult";

let dir: string;
function seed(over: Partial<SessionMeta> = {}): { registry: Registry; meta: SessionMeta } {
  const registry = new Registry(dir);
  const meta: SessionMeta = { kind: "ticket", id: "mojito-RIC-46-in-progress", ticket: "RIC-46", launchStatus: "In Progress",
    model: "opus", effort: "high", state: "running", cwd: "/x",
    createdAt: "2026-07-11T00:00:00.000Z", title: "Some ticket", labels: [], ...over };
  registry.upsert(meta);
  return { registry, meta };
}
// Default no-op deps for the ticket branch: no result file, moveToQa/clearResult never expected
// to be called unless a test overrides readResult.
function noResult(): SessionResult | null {
  return null;
}
const noopMoveToQa = async () => {};
const noopMoveToDone = async () => {};
const noopClearResult = () => {};
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-")); });

describe("handleHook — ticket sessions", () => {
  it("permission request flips to needs-input and emits an alert", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-in-progress", "PermissionRequest", {
      registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-in-progress", state: "needs-input" });
  });

  it("(a) Stop + result ready-for-qa moves the ticket to QA and marks the session done", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: () => ({ outcome: "ready-for-qa" }), moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(moveToQa).toHaveBeenCalledTimes(1);
    expect(moveToQa).toHaveBeenCalledWith("RIC-46");
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
  });

  it("(b) Stop + no result file is needs-input and never calls moveToQa", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: noResult, moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
    expect(moveToQa).not.toHaveBeenCalled();
  });

  it("(c) Stop + result blocked is needs-input and never calls moveToQa", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: () => ({ outcome: "blocked" }), moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
    expect(moveToQa).not.toHaveBeenCalled();
  });

  it("(d) SessionEnd + no result is a failure", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-in-progress", "SessionEnd", {
      registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("failed");
  });

  it("(e) Stop + ready but moveToQa rejects stays needs-input so the user can retry", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(async () => { throw new Error("Linear API error"); });
    const clearResult = vi.fn(noopClearResult);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: () => ({ outcome: "ready-for-qa" }), moveToQa, moveToDone: noopMoveToDone, clearResult,
    });
    expect(moveToQa).toHaveBeenCalledTimes(1);
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
    // A failed moveToQa must NOT clear the result file — the retry on the next Stop/SessionEnd
    // depends on the file still being there.
    expect(clearResult).not.toHaveBeenCalled();
  });

  it("(e2) a rejected moveToQa on Stop, then again on SessionEnd: still calls moveToQa each " +
    "time (the guard only blocks once state is done) and never clears the result file", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(async () => { throw new Error("Linear API error"); });
    const clearResult = vi.fn(noopClearResult);
    const readResult = () => ({ outcome: "ready-for-qa" as const });

    await handleHook("mojito-RIC-46-in-progress", "Stop", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
    expect(moveToQa).toHaveBeenCalledTimes(1);

    await handleHook("mojito-RIC-46-in-progress", "SessionEnd", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("failed");
    expect(moveToQa).toHaveBeenCalledTimes(2);
    expect(clearResult).not.toHaveBeenCalled();
  });

  it("(f) a second Stop after done does not call moveToQa again", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    const readResult = () => ({ outcome: "ready-for-qa" as const });
    await handleHook("mojito-RIC-46-in-progress", "Stop", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
    expect(moveToQa).toHaveBeenCalledTimes(1);

    await handleHook("mojito-RIC-46-in-progress", "Stop", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(moveToQa).toHaveBeenCalledTimes(1); // guarded by meta.state === "done"
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
  });

  it("a merged result moves the ticket to Done, not To QA, and clears the file", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    const moveToDone = vi.fn(noopMoveToDone);
    const clearResult = vi.fn(noopClearResult);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: () => ({ outcome: "merged", notes: "ff onto main" }), moveToQa, moveToDone, clearResult,
    });
    expect(moveToDone).toHaveBeenCalledTimes(1);
    expect(moveToDone).toHaveBeenCalledWith("RIC-46");
    expect(moveToQa).not.toHaveBeenCalled();
    expect(clearResult).toHaveBeenCalledTimes(1);
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
    expect(registry.get("mojito-RIC-46-in-progress")?.message).toBe("merged");
  });

  it("a failed Done write on a merged result keeps the file and lands at needs-input for retry", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const moveToDone = vi.fn(async () => { throw new Error("linear down"); });
    const clearResult = vi.fn(noopClearResult);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: () => ({ outcome: "merged" }), moveToQa: noopMoveToQa, moveToDone, clearResult,
    });
    expect(clearResult).not.toHaveBeenCalled();
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
  });

  it("a successful Stop clears the result file exactly once, with the session id", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    const clearResult = vi.fn(noopClearResult);
    await handleHook("mojito-RIC-46-in-progress", "Stop", {
      registry, bus, readResult: () => ({ outcome: "ready-for-qa" }), moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult,
    });
    expect(clearResult).toHaveBeenCalledTimes(1);
    expect(clearResult).toHaveBeenCalledWith("mojito-RIC-46-in-progress");
  });

  it("does not re-fire moveToQa after a revive once the result file is gone (the reported bug)", async () => {
    // Sequence from the bug report: Stop with ready-for-qa succeeds (done, file cleared);
    // the user types in the terminal (UserPromptSubmit revives to running); a later Stop
    // finds the file gone (readResult now returns null, exactly as clearResult left it) and
    // must NOT call moveToQa again.
    const { registry } = seed();
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    const clearResult = vi.fn(noopClearResult);
    let fileGone = false;
    const readResult = (): SessionResult | null => (fileGone ? null : { outcome: "ready-for-qa" });

    await handleHook("mojito-RIC-46-in-progress", "Stop", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
    expect(moveToQa).toHaveBeenCalledTimes(1);
    expect(clearResult).toHaveBeenCalledTimes(1);
    fileGone = true; // mirrors what a real clearSessionResult would have done to the file

    await handleHook("mojito-RIC-46-in-progress", "UserPromptSubmit", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("running");

    await handleHook("mojito-RIC-46-in-progress", "Stop", { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult });
    expect(moveToQa).toHaveBeenCalledTimes(1); // not called again
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("needs-input");
  });

  it("ignores an unknown session id", async () => {
    const { registry } = seed();
    const bus = new EventBus();
    await handleHook("nope", "Stop", { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    // no throw, nothing emitted
    expect(registry.get("nope")).toBeUndefined();
  });

  it("UserPromptSubmit clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude is waiting for you" });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-in-progress", "UserPromptSubmit", {
      registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    const m = registry.get("mojito-RIC-46-in-progress");
    expect(m?.state).toBe("running");
    expect(m?.message).toBeUndefined();
    expect(events).toContainEqual({ type: "session.state", id: "mojito-RIC-46-in-progress", state: "running" });
  });

  it("PostToolUse (any tool) clears needs-input back to running (RIC-117)", async () => {
    const { registry } = seed({ state: "needs-input", message: "claude needs your attention" });
    const bus = new EventBus();
    await handleHook("mojito-RIC-46-in-progress", "PostToolUse", {
      registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("running");
  });

  it("an idle Notification does NOT resurrect a finished (done) session (RIC-117)", async () => {
    // The reported bug: a session finishes its stage (done), then Claude Code fires an
    // idle Notification ~60s later. Before the fix that flipped the badge back to
    // needs-input and it stuck forever. A finished session must stay done.
    const { registry } = seed({ state: "done", message: "ready for QA" });
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-RIC-46-in-progress", "Notification", {
      registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "session.state", state: "needs-input" }),
    );
  });

  it("a Notification on a finished session never calls moveToQa (not a Stop/SessionEnd)", async () => {
    const { registry } = seed({ state: "done" });
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    await handleHook("mojito-RIC-46-in-progress", "Notification", {
      registry, bus, readResult: () => ({ outcome: "ready-for-qa" }), moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult,
    });
    expect(moveToQa).not.toHaveBeenCalled();
    expect(registry.get("mojito-RIC-46-in-progress")?.state).toBe("done");
  });
});

function seedCustom(over: Partial<SessionMeta> = {}): Registry {
  const registry = new Registry(dir);
  registry.upsert({ kind: "custom", id: "mojito-custom-general-abc", ticket: "", launchStatus: "",
    model: "opus", effort: "high", state: "running", cwd: "/home/me",
    createdAt: "2026-07-11T00:00:00.000Z", title: "home", labels: [], ...over });
  return registry;
}

describe("handleHook — custom sessions", () => {
  it("patches the title from session_title without reading the result file", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readResult = vi.fn(noResult);
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, readResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult },
      { sessionTitle: "refactor auth flow" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("refactor auth flow");
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("running");
    expect(readResult).not.toHaveBeenCalled();
  });

  it("SessionEnd on a custom session is done, not failed", async () => {
    // On the lime fall-through path a plain mapHook("SessionEnd", false) would map to
    // "failed" — not "done". A "done" result here can only come from the custom branch's
    // unconditional done-on-SessionEnd override, so this fails if that branch is deleted.
    const registry = seedCustom({ launchStatus: "In Progress" });
    const bus = new EventBus();
    const readResult = vi.fn(noResult);
    await handleHook("mojito-custom-general-abc", "SessionEnd",
      { registry, bus, readResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("done");
    expect(readResult).not.toHaveBeenCalled();
  });

  it("never calls moveToQa for a custom session", async () => {
    const registry = seedCustom({ launchStatus: "In Progress" });
    const bus = new EventBus();
    const moveToQa = vi.fn(noopMoveToQa);
    const readResult = vi.fn(noResult);
    await handleHook("mojito-custom-general-abc", "SessionEnd",
      { registry, bus, readResult, moveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(moveToQa).not.toHaveBeenCalled();
    expect(readResult).not.toHaveBeenCalled();
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("done");
  });

  it("keeps an empty session_title from clobbering the fallback label", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readResult = vi.fn(noResult);
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, readResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult },
      { sessionTitle: "" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("home");
    expect(readResult).not.toHaveBeenCalled();
  });

  it("labels the session from Claude Code's transcript title on a Stop hook", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => "Cosmetic spray base inquiry response");
    await handleHook("mojito-custom-general-abc", "Stop",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult, readTranscriptTitle },
      { transcriptPath: "/some/transcript.jsonl" });
    expect(readTranscriptTitle).toHaveBeenCalledWith("/some/transcript.jsonl");
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("Cosmetic spray base inquiry response");
  });

  it("prefers an explicit session_title over the transcript title", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => "Auto guessed title");
    await handleHook("mojito-custom-general-abc", "SessionStart",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult, readTranscriptTitle },
      { sessionTitle: "renamed by user", transcriptPath: "/some/transcript.jsonl" });
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("renamed by user");
    expect(readTranscriptTitle).not.toHaveBeenCalled();
  });

  it("does not read the transcript on the high-frequency PostToolUse hook", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => "Should not be read");
    await handleHook("mojito-custom-general-abc", "PostToolUse",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult, readTranscriptTitle },
      { transcriptPath: "/some/transcript.jsonl" });
    expect(readTranscriptTitle).not.toHaveBeenCalled();
    expect(registry.get("mojito-custom-general-abc")?.title).toBe("home");
  });

  it("keeps the fallback label when the transcript has no title yet", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const readTranscriptTitle = vi.fn(() => null);
    await handleHook("mojito-custom-general-abc", "Stop",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult, readTranscriptTitle },
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
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("idle");
    expect(events).not.toContainEqual(expect.objectContaining({ type: "session.alert" }));
  });

  it("an idle Notification on a custom session is idle, not needs-input", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "Notification",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("idle");
  });

  it("a custom session still needs input for a permission request", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));
    await handleHook("mojito-custom-general-abc", "PermissionRequest",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("needs-input");
    expect(events).toContainEqual(expect.objectContaining({ type: "session.alert", kind: "needs-input" }));
  });

  it("a custom session still needs input when claude asks a question (PreToolUse)", async () => {
    const registry = seedCustom();
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "PreToolUse",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("needs-input");
  });

  it("PostToolUse revives a custom session from idle back to running", async () => {
    const registry = seedCustom({ state: "idle" });
    const bus = new EventBus();
    await handleHook("mojito-custom-general-abc", "PostToolUse",
      { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult });
    expect(registry.get("mojito-custom-general-abc")?.state).toBe("running");
  });
});

it("does not overwrite a ticket session's title", async () => {
  const { registry } = seed({ title: "Linear title" });
  const bus = new EventBus();
  await handleHook("mojito-RIC-46-in-progress", "SessionStart",
    { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult },
    { sessionTitle: "should be ignored" });
  expect(registry.get("mojito-RIC-46-in-progress")?.title).toBe("Linear title");
});

it("never reads the transcript title for a ticket session", async () => {
  const { registry } = seed({ title: "Linear title" });
  const bus = new EventBus();
  const readTranscriptTitle = vi.fn(() => "auto title");
  await handleHook("mojito-RIC-46-in-progress", "Stop",
    { registry, bus, readResult: noResult, moveToQa: noopMoveToQa, moveToDone: noopMoveToDone, clearResult: noopClearResult, readTranscriptTitle },
    { transcriptPath: "/some/transcript.jsonl" });
  expect(readTranscriptTitle).not.toHaveBeenCalled();
  expect(registry.get("mojito-RIC-46-in-progress")?.title).toBe("Linear title");
});
