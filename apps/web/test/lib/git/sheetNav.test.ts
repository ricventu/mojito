import { describe, expect, it } from "vitest";
import { closeMove, diffEntryState } from "@/lib/git/sheetNav";

describe("diffEntryState", () => {
  it("vouches for the graph behind details reached in the app", () => {
    expect(diffEntryState(1)).toEqual({ gitDetailsOverGraph: true });
  });

  it("does not for details the tab was opened on", () => {
    expect(diffEntryState(0)).toEqual({ gitDetailsOverGraph: false });
  });
});

describe("closeMove", () => {
  it("steps back once from details reached in the app", () => {
    expect(closeMove(false, 1, null)).toEqual({ kind: "back", steps: 1 });
  });

  it("replaces details the tab was opened on with the graph", () => {
    expect(closeMove(false, 0, null)).toEqual({ kind: "replace" });
  });

  it("steps back twice from a diff opened over details over the graph", () => {
    expect(closeMove(true, 2, diffEntryState(1))).toEqual({ kind: "back", steps: 2 });
  });

  it("replaces a diff whose details were the tab's first entry", () => {
    expect(closeMove(true, 1, diffEntryState(0))).toEqual({ kind: "replace" });
  });

  it("replaces a diff the tab was opened on", () => {
    expect(closeMove(true, 0, null)).toEqual({ kind: "replace" });
  });

  it("replaces a diff with no state to vouch for what is behind it", () => {
    expect(closeMove(true, 2, null)).toEqual({ kind: "replace" });
    expect(closeMove(true, 2, { other: 1 })).toEqual({ kind: "replace" });
  });

  it("never steps back past the first entry, whatever the state claims", () => {
    expect(closeMove(true, 1, diffEntryState(1))).toEqual({ kind: "replace" });
  });

  // A replace keeps index 0 (react-router gives the entry a fresh key, so keys cannot tell it).
  describe("after the tab's first entry was replaced", () => {
    it("closes details the chevron replaced a direct diff with onto the graph, in the app", () => {
      // direct ?commit=&file= (index 0) → chevron replaces it with the details (still index 0) → ✕
      expect(closeMove(false, 0, null)).toEqual({ kind: "replace" });
    });

    it("closes a diff opened from those details onto the graph, not two steps out of the app", () => {
      // the details at index 0 push the diff (index 1) with their own index
      expect(closeMove(true, 1, diffEntryState(0))).toEqual({ kind: "replace" });
    });
  });
});
