import { describe, it, expect } from "vitest";
import { holdsSheetOpen } from "@/lib/verdictOutcome";

describe("holdsSheetOpen", () => {
  it.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["a plain string", "ok", false],
    ["a merged result", { done: "merged", commit: "abc1234" }, false],
    ["a rework-session result", { done: "rework-session" }, false],
    ["mr-created without a url", { done: "mr-created" }, false],
    ["mr-created with a non-string url", { done: "mr-created", url: 42 }, false],
    ["mr-created with a url", { done: "mr-created", url: "https://git.example/mr/7" }, true],
    ["conflict-session without a sessionId", { done: "conflict-session" }, false],
    ["conflict-session with a sessionId", { done: "conflict-session", sessionId: "mojito-RIC-110-conflict" }, true],
    ["an unrecognised done value", { done: "something-new" }, false],
  ])("%s -> %s", (_label, input, expected) => {
    expect(holdsSheetOpen(input)).toBe(expected);
  });
});
