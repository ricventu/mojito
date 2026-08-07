import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resultPath, readSessionResult, clearSessionResult } from "@/server/sessionResult";

const dir = () => mkdtempSync(join(tmpdir(), "mojito-results-"));

describe("sessionResult", () => {
  it("round-trips a ready-for-qa result", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s1"), JSON.stringify({ outcome: "ready-for-qa", notes: "built X" }));
    expect(readSessionResult(stateDir, "s1")).toEqual({ outcome: "ready-for-qa", notes: "built X" });
  });
  it("returns null for a missing file", () => {
    expect(readSessionResult(dir(), "absent")).toBeNull();
  });
  it("returns null for malformed JSON and unknown outcomes", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "bad"), "{nope");
    expect(readSessionResult(stateDir, "bad")).toBeNull();
    writeFileSync(resultPath(stateDir, "odd"), JSON.stringify({ outcome: "done" }));
    expect(readSessionResult(stateDir, "odd")).toBeNull();
  });
  it("clear removes the file and tolerates absence", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s2"), JSON.stringify({ outcome: "blocked" }));
    clearSessionResult(stateDir, "s2");
    expect(readSessionResult(stateDir, "s2")).toBeNull();
    clearSessionResult(stateDir, "s2"); // second call must not throw
  });
});
