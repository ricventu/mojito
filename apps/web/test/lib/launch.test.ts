import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS, type Settings } from "@mojito/shared";
import { ApiError } from "@/lib/api";
import { launchErrorAction, launchOptions } from "@/lib/launch";

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
