import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTranscriptTitle } from "@/server/sessionTitle";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mojito-transcript-")); });

function transcript(lines: unknown[]): string {
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

describe("readTranscriptTitle", () => {
  it("returns the customTitle from a custom-title line", () => {
    const path = transcript([
      { type: "user", message: {} },
      { type: "custom-title", sessionId: "abc", customTitle: "Cosmetic spray base inquiry response" },
    ]);
    expect(readTranscriptTitle(path)).toBe("Cosmetic spray base inquiry response");
  });

  it("returns the LAST custom-title when Claude Code re-titles the session", () => {
    const path = transcript([
      { type: "custom-title", customTitle: "First guess" },
      { type: "assistant", message: {} },
      { type: "custom-title", customTitle: "Refined title" },
    ]);
    expect(readTranscriptTitle(path)).toBe("Refined title");
  });

  it("returns null when there is no custom-title line", () => {
    const path = transcript([{ type: "user", message: {} }, { type: "assistant", message: {} }]);
    expect(readTranscriptTitle(path)).toBeNull();
  });

  it("returns null when the transcript file does not exist", () => {
    expect(readTranscriptTitle(join(dir, "missing.jsonl"))).toBeNull();
  });

  it("skips malformed lines and still finds a valid custom-title", () => {
    const path = join(dir, "mixed.jsonl");
    writeFileSync(path, [
      "not json at all",
      JSON.stringify({ type: "custom-title", customTitle: "Survivor" }),
      "{ broken",
    ].join("\n"));
    expect(readTranscriptTitle(path)).toBe("Survivor");
  });

  it("ignores a custom-title line with an empty title", () => {
    const path = transcript([
      { type: "custom-title", customTitle: "Real title" },
      { type: "custom-title", customTitle: "" },
    ]);
    expect(readTranscriptTitle(path)).toBe("Real title");
  });
});
