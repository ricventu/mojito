import { describe, expect, it } from "vitest";
import { closeMove, diffEntryState } from "@/lib/git/sheetNav";

describe("diffEntryState", () => {
  it("vouches for the graph behind a details entry reached in the app", () => {
    expect(diffEntryState("k1")).toEqual({ gitDetailsOverGraph: true });
  });

  it("does not for a details entry the tab was opened on", () => {
    expect(diffEntryState("default")).toEqual({ gitDetailsOverGraph: false });
  });
});

describe("closeMove", () => {
  it("steps back once from details reached in the app", () => {
    expect(closeMove(false, "k1", null)).toEqual({ kind: "back", steps: 1 });
  });

  it("replaces details the tab was opened on with the graph", () => {
    expect(closeMove(false, "default", null)).toEqual({ kind: "replace" });
  });

  it("steps back twice from a diff opened over details over the graph", () => {
    expect(closeMove(true, "k2", diffEntryState("k1"))).toEqual({ kind: "back", steps: 2 });
  });

  it("replaces a diff whose details were the tab's first entry", () => {
    expect(closeMove(true, "k2", diffEntryState("default"))).toEqual({ kind: "replace" });
  });

  it("replaces a diff the tab was opened on", () => {
    expect(closeMove(true, "default", null)).toEqual({ kind: "replace" });
  });

  it("replaces a diff with no state to vouch for what is behind it", () => {
    expect(closeMove(true, "k2", null)).toEqual({ kind: "replace" });
    expect(closeMove(true, "k2", { other: 1 })).toEqual({ kind: "replace" });
  });
});
