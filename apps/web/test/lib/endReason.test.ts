import { describe, expect, it } from "vitest";
import { canResume, endLook } from "../../src/lib/endReason";

describe("endLook", () => {
  it("reads an /exit as a plain end", () => {
    expect(endLook("exited")).toMatchObject({ label: "Ended", abnormal: false });
  });

  it("calls out an end nobody asked for", () => {
    expect(endLook("oom")).toMatchObject({ label: "Out of memory", abnormal: true });
    expect(endLook("gone")).toMatchObject({ label: "Lost", abnormal: true });
    expect(endLook("other")).toMatchObject({ label: "Stopped", abnormal: true });
  });

  it("reads no reason — an old row, a peer that sends none, a value it does not know — as a plain end", () => {
    for (const r of [null, undefined, "bogus" as never]) {
      expect(endLook(r)).toEqual({ label: "Ended", description: "Session ended.", abnormal: false });
    }
  });
});

describe("canResume", () => {
  const s = { state: "ended" as const, kind: "claude" as const, claudeSessionId: "aaaa-1" };

  it("is an ended claude session with its conversation on record", () => {
    expect(canResume(s)).toBe(true);
    expect(canResume({ ...s, kind: "ticket" })).toBe(true);
  });

  it("is never a live session, a shell, or one with no conversation id", () => {
    expect(canResume({ ...s, state: "idle" })).toBe(false);
    expect(canResume({ ...s, kind: "shell" })).toBe(false);
    expect(canResume({ ...s, claudeSessionId: null })).toBe(false);
    // A peer that predates the field sends none at all.
    expect(canResume({ ...s, claudeSessionId: undefined as unknown as null })).toBe(false);
  });
});
