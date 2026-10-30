import type { GraphHighlight } from "@mojito/shared";
import { describe, expect, it } from "vitest";
import { highlightChain, highlightSummary } from "@/lib/git/highlight";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe("highlightChain", () => {
  // main: m2 -> m1 -> root; feature: f2 -> f1 -> m1
  const commits = [c("f2", "f1"), c("m2", "m1"), c("f1", "m1"), c("m1", "root"), c("root")];

  it("is the branch's own commits for an unmerged branch", () => {
    expect([...highlightChain(commits, "f2", "m2")].sort()).toEqual(["f1", "f2"]);
  });

  it("is empty for a branch fast-forwarded into the base", () => {
    expect(highlightChain(commits, "m1", "m2").size).toBe(0);
  });

  it("is empty for a fresh branch at the base tip", () => {
    expect(highlightChain(commits, "m2", "m2").size).toBe(0);
  });

  it("stops at the window's edge", () => {
    expect([...highlightChain([c("f2", "f1")], "f2", "m2")]).toEqual(["f2"]);
  });

  it("is empty when the tip is not loaded", () => {
    expect(highlightChain(commits, "nope", "m2").size).toBe(0);
  });
});

const h = (over: Partial<GraphHighlight> = {}): GraphHighlight => ({
  branch: "ric-505-git",
  tip: "t",
  base: "origin/main",
  baseTip: "b",
  ahead: 3,
  behind: 12,
  merged: false,
  ...over,
});

describe("highlightSummary", () => {
  it("says there is no branch for a ticket", () => {
    expect(highlightSummary(null, "RIC-505")).toBe("No branch for RIC-505 yet");
  });

  it("is null with no highlight and no ticket", () => {
    expect(highlightSummary(null, null)).toBeNull();
  });

  it("is the branch alone without a base", () => {
    expect(highlightSummary(h({ base: "", baseTip: "" }), null)).toBe("ric-505-git");
  });

  it("says even with the base when the tip is the base's tip", () => {
    expect(highlightSummary(h({ tip: "b", ahead: 0, merged: true }), null)).toBe("ric-505-git · even with origin/main");
  });

  it("says merged", () => {
    expect(highlightSummary(h({ ahead: 0, merged: true }), "RIC-505")).toBe("ric-505-git · merged into origin/main");
  });

  it("counts ahead and behind", () => {
    expect(highlightSummary(h(), null)).toBe("ric-505-git · 3 ahead · 12 behind origin/main");
  });
});
