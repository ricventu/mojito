import { describe, expect, it } from "vitest";
import { canGoBack, historyDepth, pushedState } from "@/lib/navDepth";

describe("historyDepth", () => {
  it("reads a fresh document as depth zero", () => {
    expect(historyDepth(null)).toBe(0);
    expect(historyDepth(undefined)).toBe(0);
    expect(historyDepth({})).toBe(0);
  });

  it("reads the depth the app stamped", () => {
    expect(historyDepth({ mojitoDepth: 3 })).toBe(3);
  });

  it("ignores a depth that is not a number", () => {
    expect(historyDepth({ mojitoDepth: "3" })).toBe(0);
  });

  it("never reports a negative depth", () => {
    expect(historyDepth({ mojitoDepth: -1 })).toBe(0);
  });
});

describe("canGoBack", () => {
  it("is false on the entry the app was opened on", () => {
    expect(canGoBack(null)).toBe(false);
    expect(canGoBack({ mojitoDepth: 0 })).toBe(false);
  });

  it("is true once the app has pushed an entry of its own", () => {
    expect(canGoBack({ mojitoDepth: 1 })).toBe(true);
  });
});

describe("pushedState", () => {
  it("stamps depth one onto the first push of a document", () => {
    expect(pushedState(null)).toEqual({ mojitoDepth: 1 });
  });

  it("counts up from the current entry", () => {
    expect(pushedState({ mojitoDepth: 2 })).toEqual({ mojitoDepth: 3 });
  });

  it("keeps foreign keys, so another owner's history state survives a push", () => {
    expect(pushedState({ __NA: true })).toEqual({ __NA: true, mojitoDepth: 1 });
  });
});
