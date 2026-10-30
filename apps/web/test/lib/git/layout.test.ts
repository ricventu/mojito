import { describe, expect, it } from "vitest";
import { PALETTE_SIZE, layoutGraph } from "@/lib/git/layout";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });
const opts = { maxLanes: 8 };

describe("layoutGraph", () => {
  it("keeps a linear history in lane 0", () => {
    const { rows, laneCount, hiddenLanes } = layoutGraph([c("a", "b"), c("b", "c"), c("c")], opts);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(laneCount).toBe(1);
    expect(hiddenLanes).toBe(0);
    expect(rows[0]!.top).toEqual([]);
    expect(rows[0]!.bottom).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[1]!.top).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[2]!.bottom).toEqual([]);
  });

  it("opens a lane at a merge, puts the side commit in it and converges back", () => {
    // m merges s into main; both come from base
    const { rows, laneCount } = layoutGraph([c("m", "base", "s"), c("s", "base"), c("base")], opts);
    expect(rows[0]!.lane).toBe(0);
    expect(rows[0]!.bottom).toEqual([
      { from: 0, to: 1, color: 1 },
      { from: 0, to: 0, color: 0 },
    ]);
    expect(rows[1]!.lane).toBe(1);
    expect(rows[1]!.color).toBe(1);
    expect(rows[1]!.top).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 1, color: 1 },
    ]);
    // base converges the side lane into lane 0
    expect(rows[2]!.lane).toBe(0);
    expect(rows[2]!.top).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 1, to: 0, color: 1 },
    ]);
    expect(rows[2]!.bottom).toEqual([]);
    expect(laneCount).toBe(2);
  });

  it("opens two lanes in one row for an octopus merge", () => {
    const { rows, laneCount } = layoutGraph([c("o", "a", "b", "d"), c("a"), c("b"), c("d")], opts);
    expect(rows[0]!.bottom.map((s) => [s.from, s.to])).toEqual([
      [0, 1],
      [0, 2],
      [0, 0],
    ]);
    expect(laneCount).toBe(3);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 2]);
  });

  it("puts two parallel tips in lanes 0 and 1", () => {
    const { rows } = layoutGraph([c("x", "base"), c("y", "base"), c("base")], opts);
    expect(rows.map((r) => r.lane)).toEqual([0, 1, 0]);
    expect(rows[1]!.top).toEqual([{ from: 0, to: 0, color: 0 }]);
    expect(rows[2]!.top.map((s) => [s.from, s.to])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("keeps a lane open past the last row when the parent is outside the window", () => {
    const { rows } = layoutGraph([c("a", "b"), c("b", "gone")], opts);
    expect(rows[1]!.bottom).toEqual([{ from: 0, to: 0, color: 0 }]);
  });

  it("draws a slot freed and reopened in the same row only as the curve from the commit", () => {
    // t is a second tip waiting in lane 1 for m; m (lane 0) converges lane 1 into itself,
    // then its merge parent p reopens the freed slot 1.
    const { rows } = layoutGraph([c("a", "m"), c("t", "m"), c("m", "z", "p"), c("z"), c("p")], opts);
    const merge = rows[2]!;
    expect(merge.top.map((s) => [s.from, s.to])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(merge.bottom.map((s) => [s.from, s.to])).toEqual([
      [0, 1],
      [0, 0],
    ]);
    expect(merge.bottom.filter((s) => s.to === 1)).toHaveLength(1);
    expect(merge.bottom.some((s) => s.from === 1 && s.to === 1)).toBe(false);
  });

  it("reuses a lane already waiting for a merge parent", () => {
    // a opens lane 1 for p; b (a new tip, lane 2) merges p again: a curve into lane 1, no new slot
    const { rows, laneCount } = layoutGraph([c("a", "z", "p"), c("b", "z", "p"), c("z"), c("p")], opts);
    const pColor = rows[0]!.bottom.find((s) => s.to === 1 && s.from === 0)!.color;
    const second = rows[1]!;
    expect(second.lane).toBe(2);
    expect(second.bottom).toContainEqual({ from: 2, to: 1, color: pColor });
    expect(second.bottom.filter((s) => s.from === 1 && s.to === 1)).toHaveLength(1);
    expect(laneCount).toBe(3);
  });

  it("keeps the colour along first parents and gives a merge lane a new one", () => {
    const { rows } = layoutGraph([c("m", "base", "s"), c("s", "base"), c("base")], opts);
    expect(rows[0]!.color).toBe(rows[2]!.color);
    expect(rows[1]!.color).not.toBe(rows[0]!.color);
    expect(rows[0]!.bottom[0]!.color).toBe(rows[1]!.color);
  });

  it("cycles colours through the palette", () => {
    const tips = Array.from({ length: PALETTE_SIZE + 1 }, (_, i) => c(`t${i}`, "base"));
    const { rows } = layoutGraph([...tips, c("base")], { maxLanes: 20 });
    expect(rows[PALETTE_SIZE]!.color).toBe(0);
    expect(rows.every((r) => r.color < PALETTE_SIZE)).toBe(true);
  });

  it("folds lanes past maxLanes into the last column without duplicate segments", () => {
    const { rows, laneCount, hiddenLanes } = layoutGraph(
      [c("a", "base"), c("b", "base"), c("c", "base"), c("d", "base"), c("base")],
      { maxLanes: 2 },
    );
    expect(laneCount).toBe(4);
    expect(hiddenLanes).toBe(2);
    for (const r of rows) {
      expect(r.lane).toBeLessThanOrEqual(1);
      for (const s of [...r.top, ...r.bottom]) {
        expect(s.from).toBeLessThanOrEqual(1);
        expect(s.to).toBeLessThanOrEqual(1);
      }
      for (const segs of [r.top, r.bottom]) {
        const keys = segs.map((s) => `${s.from}:${s.to}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
    expect(rows[4]!.top.map((s) => [s.from, s.to])).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("answers an empty window", () => {
    expect(layoutGraph([], opts)).toEqual({ rows: [], laneCount: 0, hiddenLanes: 0 });
  });
});
