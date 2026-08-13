import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resultPath, readSessionResult, clearSessionResult } from "@/server/sessionResult";

const dir = () => mkdtempSync(join(tmpdir(), "mojito-results-"));

describe("sessionResult", () => {
  it("round-trips a ready-for-qa result", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s1"), JSON.stringify({ outcome: "ready-for-qa" }));
    expect(readSessionResult(stateDir, "s1")).toEqual({ outcome: "ready-for-qa" });
  });
  it("round-trips a merged result (the merge-fix session's outcome)", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s3"), JSON.stringify({ outcome: "merged" }));
    expect(readSessionResult(stateDir, "s3")).toEqual({ outcome: "merged" });
  });
  // The result file is a status signal, nothing more: a session with something to say says it
  // in its terminal, which stays open at To QA.
  it("drops a notes field instead of carrying it", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s4"), JSON.stringify({ outcome: "ready-for-qa", notes: "built X" }));
    expect(readSessionResult(stateDir, "s4")).toEqual({ outcome: "ready-for-qa" });
  });
  it("returns null for the retired blocked outcome", () => {
    const stateDir = dir();
    writeFileSync(resultPath(stateDir, "s5"), JSON.stringify({ outcome: "blocked" }));
    expect(readSessionResult(stateDir, "s5")).toBeNull();
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
    writeFileSync(resultPath(stateDir, "s2"), JSON.stringify({ outcome: "ready-for-qa" }));
    clearSessionResult(stateDir, "s2");
    expect(readSessionResult(stateDir, "s2")).toBeNull();
    clearSessionResult(stateDir, "s2"); // second call must not throw
  });
});
