import { describe, it, expect } from "vitest";
import { holdsSheetOpen } from "@/lib/verdictOutcome";

describe("holdsSheetOpen", () => {
  it.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["a plain string", "ok", false],
    ["a merged result", { done: "merged", commit: "abc1234" }, false],
    ["the retired rework-session value", { done: "rework-session" }, false],
    ["mr-created without a url", { done: "mr-created" }, false],
    ["mr-created with a non-string url", { done: "mr-created", url: 42 }, false],
    ["mr-created with a url", { done: "mr-created", url: "https://git.example/mr/7" }, true],
    ["fix-session without a sessionId", { done: "fix-session" }, false],
    ["fix-session with a sessionId", { done: "fix-session", sessionId: "mojito-RIC-110-conflict", detail: "x" }, true],
    ["the retired conflict-session value", { done: "conflict-session", sessionId: "mojito-RIC-110-conflict" }, false],
    ["an unrecognised done value", { done: "something-new" }, false],
  ])("%s -> %s", (_label, input, expected) => {
    expect(holdsSheetOpen(input)).toBe(expected);
  });
});
