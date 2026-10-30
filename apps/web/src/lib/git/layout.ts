// Lane layout of the git graph. Pure: the page only paints what this answers.

export const PALETTE_SIZE = 8;

/** A line between two lane indices; `color` indexes the palette. */
export interface Segment {
  from: number;
  to: number;
  color: number;
}

/**
 * `top` enters the row from above and ends at the commit's dot, `bottom` leaves the dot for the
 * row below, so every row draws on its own.
 */
export interface GraphRow {
  lane: number;
  color: number;
  top: Segment[];
  bottom: Segment[];
}

export interface GraphLayout {
  rows: GraphRow[];
  laneCount: number;
  hiddenLanes: number;
}

/** A lane is waiting for one commit; `null` is a free slot. */
type Lane = { hash: string; color: number } | null;

const firstFree = (lanes: Lane[]): number => {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
};

/** Commits in topo order (children before parents). See the spec, §3.1, for the four steps. */
export function layoutGraph(
  commits: { hash: string; parents: string[] }[],
  opts: { maxLanes: number },
): GraphLayout {
  const lanes: Lane[] = [];
  let colorCount = 0;
  const newColor = () => colorCount++ % PALETTE_SIZE;
  let laneCount = 0;
  const rows: GraphRow[] = [];

  for (const { hash, parents } of commits) {
    // 1. the first lane waiting for this commit, else a new tip takes the first free slot
    const waiting = lanes.findIndex((l) => l?.hash === hash);
    const lane = waiting === -1 ? firstFree(lanes) : waiting;
    const color = waiting === -1 ? newColor() : lanes[lane]!.color;

    // 2. every lane waiting for it converges into it and is freed
    const top: Segment[] = [];
    lanes.forEach((l, i) => {
      if (!l) return;
      const converges = l.hash === hash;
      top.push({ from: i, to: converges ? lane : i, color: l.color });
      if (converges) lanes[i] = null;
    });

    // 3. the lane goes on waiting for the first parent (none: a root frees it), same colour
    const [first, ...merged] = parents;
    lanes[lane] = first ? { hash: first, color } : null;

    // 4. each further parent reuses a lane already waiting for it or opens a free slot. Lanes
    // opened here are recorded as they open, not inferred from `top`: a slot freed by a
    // convergence in this same row was occupied above, but the lane that reopens it starts at
    // the commit, so it must not also get a straight segment (v1 drew that stray line).
    const curves: Segment[] = [];
    const opened = new Set<number>();
    for (const parent of merged) {
      const existing = lanes.findIndex((l) => l?.hash === parent);
      if (existing !== -1) {
        curves.push({ from: lane, to: existing, color: lanes[existing]!.color });
        continue;
      }
      const slot = firstFree(lanes);
      const c = newColor();
      lanes[slot] = { hash: parent, color: c };
      opened.add(slot);
      curves.push({ from: lane, to: slot, color: c });
    }
    const bottom = [...curves];
    lanes.forEach((l, i) => {
      if (l && !opened.has(i)) bottom.push({ from: i, to: i, color: l.color });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lanes.length, lane + 1, ...top.map((s) => s.from + 1));
    rows.push({ lane, color, top, bottom });
  }

  // Lanes at or past `maxLanes` fold into the last column; segments that then coincide are one.
  const last = Math.max(1, opts.maxLanes) - 1;
  const col = (i: number) => Math.min(i, last);
  const fold = (segments: Segment[]): Segment[] => {
    const seen = new Set<string>();
    const out: Segment[] = [];
    for (const s of segments) {
      const folded = { from: col(s.from), to: col(s.to), color: s.color };
      const key = `${folded.from}:${folded.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(folded);
    }
    return out;
  };

  return {
    rows: rows.map((r) => ({ lane: col(r.lane), color: r.color, top: fold(r.top), bottom: fold(r.bottom) })),
    laneCount,
    hiddenLanes: Math.max(0, laneCount - (last + 1)),
  };
}
