import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS, type SessionMeta, type Settings } from "@mojito/shared";
import { ApiError } from "@/lib/api";
import { launchErrorAction, launchOptions, withLaunched } from "@/lib/launch";

const settings: Settings = {
  statusDefaults: { Todo: { model: "sonnet", effort: "medium" } },
  prompts: DEFAULT_PROMPTS,
  favorites: [],
};

describe("launchOptions", () => {
  it("uses the status default when there is one", () => {
    expect(launchOptions("Todo", settings)).toEqual({ model: "sonnet", effort: "medium" });
  });

  it("falls back to opus/high for an unknown status", () => {
    expect(launchOptions("Weird", settings)).toEqual({ model: "opus", effort: "high" });
  });

  it("follows a status change for whatever the human has not picked", () => {
    expect(launchOptions("Weird", settings, { effort: "low" })).toEqual({ model: "opus", effort: "low" });
    expect(launchOptions("Todo", settings, { effort: "low" })).toEqual({ model: "sonnet", effort: "low" });
    expect(launchOptions("Todo", settings, { model: "haiku", effort: "max" })).toEqual({ model: "haiku", effort: "max" });
  });
});

describe("launchErrorAction", () => {
  it("opens the live session on a 409 that names it", () => {
    const err = new ApiError(409, "already live", { error: "already live", sessionId: "mj-RIC-1" });
    expect(launchErrorAction(err)).toEqual({ kind: "open", sessionId: "mj-RIC-1" });
  });

  it("toasts the message on a 409 without a session id", () => {
    expect(launchErrorAction(new ApiError(409, "occupato", { error: "occupato" }))).toEqual({
      kind: "toast",
      message: "occupato",
    });
  });

  it("toasts the message on a 400", () => {
    expect(launchErrorAction(new ApiError(400, "project path not found: /x", undefined))).toEqual({
      kind: "toast",
      message: "project path not found: /x",
    });
  });
});

describe("withLaunched", () => {
  const row = (id: string, state: SessionMeta["state"], lastEventAt: number): SessionMeta => ({
    id,
    kind: "ticket",
    project: "Web",
    ticket: "RIC-1",
    cwd: "/repo",
    model: "opus",
    effort: "high",
    state,
    alert: null,
    createdAt: lastEventAt,
    lastEventAt,
    title: null,
    endReason: null,
    claudeSessionId: null,
  });

  it("adds the launched session to the list", () => {
    const other = row("mj-x", "running", 1);
    expect(withLaunched([other], row("mj-RIC-1", "starting", 5))).toEqual([other, row("mj-RIC-1", "starting", 5)]);
  });

  it("replaces the ended row the launch reused the id of", () => {
    expect(withLaunched([row("mj-RIC-1", "ended", 1)], row("mj-RIC-1", "starting", 5))).toEqual([row("mj-RIC-1", "starting", 5)]);
  });

  it("keeps a newer copy that an event brought before the launch answered", () => {
    const newer = row("mj-RIC-1", "running", 6);
    expect(withLaunched([newer], row("mj-RIC-1", "starting", 5))).toEqual([newer]);
  });

  it("leaves a list that has not loaded alone", () => {
    expect(withLaunched(undefined, row("mj-RIC-1", "starting", 5))).toBeUndefined();
  });
});
