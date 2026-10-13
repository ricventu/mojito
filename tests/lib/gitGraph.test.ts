import { describe, it, expect } from "vitest";
import { highlightChain, highlightSummary, layoutGraph } from "@/lib/gitGraph";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });
const WIDE = { maxLanes: 12 };
// Row shapes without colours, for the topology assertions.
const shape = (rows: ReturnType<typeof layoutGraph>["rows"]) =>
  rows.map((r) => ({
    lane: r.lane,
    top: r.top.map((s) => [s.from, s.to]),
    bottom: r.bottom.map((s) => [s.from, s.to]),
  }));

describe("layoutGraph", () => {
  it("draws linear history in one lane", () => {
    const { rows, laneCount } = layoutGraph([c("3", "2"), c("2", "1"), c("1")], WIDE);
    expect(laneCount).toBe(1);
    expect(shape(rows)).toEqual([
      { lane: 0, top: [], bottom: [[0, 0]] },
      { lane: 0, top: [[0, 0]], bottom: [[0, 0]] },
      { lane: 0, top: [[0, 0]], bottom: [] },
    ]);
  });

  it("forks two tips off a shared parent and converges them there", () => {
    // main: M2 → B; feat: F1 → B
    const { rows } = layoutGraph([c("M2", "B"), c("F1", "B"), c("B")], WIDE);
    expect(shape(rows)).toEqual([
      { lane: 0, top: [], bottom: [[0, 0]] },
      { lane: 1, top: [[0, 0]], bottom: [[0, 0], [1, 1]] },
      { lane: 0, top: [[0, 0], [1, 0]], bottom: [] },
    ]);
  });

  it("opens a lane for a merge's second parent and closes it at the fork point", () => {
    // M merges F into main: M(parents A, F), F → B, A → B
    const { rows } = layoutGraph([c("M", "A", "F"), c("F", "B"), c("A", "B"), c("B")], WIDE);
    expect(shape(rows)).toEqual([
      { lane: 0, top: [], bottom: [[0, 1], [0, 0]] },
      { lane: 1, top: [[0, 0], [1, 1]], bottom: [[0, 0], [1, 1]] },
      { lane: 0, top: [[0, 0], [1, 1]], bottom: [[0, 0], [1, 1]] },
      { lane: 0, top: [[0, 0], [1, 0]], bottom: [] },
    ]);
  });

  it("opens one lane per extra parent of an octopus merge", () => {
    const { rows, laneCount } = layoutGraph([c("O", "A", "B", "C"), c("A"), c("B"), c("C")], WIDE);
    expect(laneCount).toBe(3);
    expect(rows[0].bottom.map((s) => [s.from, s.to])).toEqual([[0, 1], [0, 2], [0, 0]]);
  });

  it("opens a merge's parent lane in a column freed by a convergence in the same row", () => {
    // F1 and F2 both wait on X in lanes 0 and 1; X merges P and Q, and Q opens lane 1
    // again. That lane must start at X's curve only, with no straight run beside it.
    const { rows } = layoutGraph([c("F1", "X"), c("F2", "X"), c("X", "P", "Q"), c("Q", "P"), c("P")], WIDE);
    expect(rows[2].bottom.map((s) => [s.from, s.to])).toEqual([[0, 1], [0, 0]]);
  });

  it("reuses the lane already waiting for a merge parent instead of opening another", () => {
    // T1 → P on lane 0; M on lane 1 merges P too.
    const { rows, laneCount } = layoutGraph([c("T1", "P"), c("M", "Q", "P"), c("Q", "P"), c("P")], WIDE);
    expect(laneCount).toBe(2);
    expect(rows[1].bottom.map((s) => [s.from, s.to])).toEqual([[1, 0], [0, 0], [1, 1]]);
  });

  it("leaves a lane open at the bottom when the parent is outside the window", () => {
    const { rows } = layoutGraph([c("2", "1")], WIDE);
    expect(shape(rows)).toEqual([{ lane: 0, top: [], bottom: [[0, 0]] }]);
  });

  it("reuses a freed lane for a later tip", () => {
    const { rows, laneCount } = layoutGraph([c("A", "R"), c("B", "R"), c("R"), c("X")], WIDE);
    expect(laneCount).toBe(2);
    expect(rows[3].lane).toBe(0);
  });

  it("keeps a branch's colour along its first parents and gives a new tip a new one", () => {
    const { rows } = layoutGraph([c("M2", "M1"), c("F1", "M1"), c("M1", "M0"), c("M0")], WIDE);
    expect(rows[0].color).toBe(rows[2].color);
    expect(rows[2].color).toBe(rows[3].color);
    expect(rows[1].color).not.toBe(rows[0].color);
  });

  it("folds lanes beyond the cap into the last column and says how many", () => {
    const tips = ["A", "B", "C", "D"].map((h) => c(h, "R"));
    const { rows, laneCount, hiddenLanes } = layoutGraph([...tips, c("R")], { maxLanes: 2 });
    expect(laneCount).toBe(4);
    expect(hiddenLanes).toBe(2);
    for (const r of rows) {
      expect(r.lane).toBeLessThan(2);
      for (const s of [...r.top, ...r.bottom]) expect(Math.max(s.from, s.to)).toBeLessThan(2);
    }
  });
});

describe("highlightChain", () => {
  // main: M2 → M1 → M0; feat: F2 → F1 → M1
  const commits = [c("F2", "F1"), c("M2", "M1"), c("F1", "M1"), c("M1", "M0"), c("M0")];

  it("is the branch's own first-parent run down to where it left the base", () => {
    expect([...highlightChain(commits, "F2", "M2")]).toEqual(["F2", "F1"]);
  });

  it("is empty for a branch fast-forwarded into the base", () => {
    expect(highlightChain(commits, "M1", "M2").size).toBe(0);
  });

  it("is the whole loaded run when there is no base to stop at", () => {
    expect([...highlightChain(commits, "F2", "")]).toEqual(["F2", "F1", "M1", "M0"]);
  });
});

describe("highlightSummary", () => {
  const h = { branch: "RIC-1-x", tip: "t", base: "origin/main", baseTip: "b", ahead: 3, behind: 12, merged: false };
  it("counts ahead and behind", () => {
    expect(highlightSummary(h, true)).toBe("RIC-1-x · 3 ahead · 12 behind origin/main");
  });
  it("says merged", () => {
    expect(highlightSummary({ ...h, ahead: 0, merged: true }, true)).toBe("RIC-1-x · merged into origin/main");
  });
  // A branch just cut from its base has nothing ahead, which the server's `merged`
  // flag cannot tell apart from a merge; same tip is the case that can be told.
  it("says even with, not merged, when the branch sits on the base's tip", () => {
    expect(highlightSummary({ ...h, ahead: 0, behind: 0, merged: true, tip: "b" }, true))
      .toBe("RIC-1-x · even with origin/main");
  });
  it("names the branch alone without a base", () => {
    expect(highlightSummary({ ...h, base: "", baseTip: "" }, false)).toBe("RIC-1-x");
  });
  it("tells a ticket it has no branch yet, and says nothing for a project", () => {
    expect(highlightSummary(null, true)).toBe("No worktree for this ticket yet");
    expect(highlightSummary(null, false)).toBeNull();
  });
});
