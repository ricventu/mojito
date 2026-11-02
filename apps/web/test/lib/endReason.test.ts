import { describe, expect, it } from "vitest";
import { endLook } from "../../src/lib/endReason";

describe("endLook", () => {
  it("reads a Kill or an /exit as a plain end", () => {
    expect(endLook("killed")).toMatchObject({ label: "Ended", abnormal: false });
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
