// The git graph's lane layout — pure, so the drawing rules are testable in the node-only
// setup; GitGraphView only paints what this answers.

// Mirrors of src/server/gitGraph.ts, declared again rather than imported: that module
// loads node:child_process and has no business in the browser bundle (as useDocs.ts).
export interface GraphRef { name: string; kind: "local" | "remote" | "tag"; worktree?: true; mojito?: true }
export interface GraphCommit { hash: string; parents: string[]; author: string; date: string; subject: string; refs: GraphRef[] }
export interface GraphHighlight { branch: string; tip: string; base: string; baseTip: string; ahead: number; behind: number; merged: boolean }
export interface GraphPage { label: string; head: string | null; highlight: GraphHighlight | null; commits: GraphCommit[]; hasMore: boolean }
export interface CommitFile { status: string; path: string; from?: string }
export interface CommitDetails {
  hash: string; parents: string[]; author: string; email: string; date: string;
  message: string; files: CommitFile[]; moreFiles: number;
}

export const PALETTE_SIZE = 8;

export interface Segment { from: number; to: number; color: number }
// `top` enters the row from above and ends at the commit's height; `bottom` leaves from
// there to the row below. Each row is therefore drawable on its own.
export interface GraphRow { lane: number; color: number; top: Segment[]; bottom: Segment[] }
export interface GraphLayout { rows: GraphRow[]; laneCount: number; hiddenLanes: number }

type Lane = { hash: string; color: number } | null;

function freeSlot(lanes: Lane[]): number {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
}

/**
 * Lanes for commits in topo order (children before parents). Each lane holds the commit
 * it is waiting for: a commit lands in the first lane waiting for it (or a free one, as a
 * new tip), every other lane waiting for it converges there, and the lane goes on to wait
 * for its first parent. Each further parent reuses a lane already waiting for it or opens
 * one. Colour is fixed when a lane opens and inherited along first parents, so a branch
 * keeps one colour for its whole run.
 */
export function layoutGraph(commits: { hash: string; parents: string[] }[], opts: { maxLanes: number }): GraphLayout {
  let lanes: Lane[] = [];
  let nextColor = 0;
  let laneCount = 0;
  const raw: GraphRow[] = [];

  for (const commit of commits) {
    let lane = lanes.findIndex((l) => l?.hash === commit.hash);
    let color: number;
    if (lane === -1) {
      lane = freeSlot(lanes);
      color = nextColor++ % PALETTE_SIZE;
    } else {
      color = lanes[lane]!.color;
    }

    const top: Segment[] = [];
    lanes.forEach((l, i) => {
      if (l) top.push({ from: i, to: l.hash === commit.hash ? lane : i, color: l.color });
    });
    lanes = lanes.map((l) => (l?.hash === commit.hash ? null : l));

    const [first, ...rest] = commit.parents;
    lanes[lane] = first ? { hash: first, color } : null;

    const bottom: Segment[] = [];
    // Lanes this commit's merge parents open. Each one starts at the commit: its curve is
    // its whole run in this row's bottom half, so it takes no straight segment as well.
    // Recorded as they open, not inferred from `top`: a slot freed by a convergence in this
    // same row was occupied above, yet the new lane still starts at the commit.
    const opened = new Set<number>();
    for (const parent of rest) {
      const waiting = lanes.findIndex((l) => l?.hash === parent);
      if (waiting !== -1) {
        bottom.push({ from: lane, to: waiting, color: lanes[waiting]!.color });
        continue;
      }
      const slot = freeSlot(lanes);
      const pc = nextColor++ % PALETTE_SIZE;
      lanes[slot] = { hash: parent, color: pc };
      opened.add(slot);
      bottom.push({ from: lane, to: slot, color: pc });
    }
    lanes.forEach((l, i) => {
      if (l && !opened.has(i)) bottom.push({ from: i, to: i, color: l.color });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lanes.length, lane + 1, ...top.map((s) => s.from + 1));
    raw.push({ lane, color, top, bottom });
  }

  const cap = Math.max(1, opts.maxLanes);
  const col = (i: number) => Math.min(i, cap - 1);
  const fold = (segs: Segment[]) => {
    const seen = new Set<string>();
    return segs
      .map((s) => ({ from: col(s.from), to: col(s.to), color: s.color }))
      .filter((s) => {
        const key = `${s.from}:${s.to}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  return {
    rows: raw.map((r) => ({ lane: col(r.lane), color: r.color, top: fold(r.top), bottom: fold(r.bottom) })),
    laneCount,
    hiddenLanes: Math.max(0, laneCount - cap),
  };
}

/**
 * The highlighted branch's own commits within the loaded window: its first-parent run
 * from the tip down to (excluding) the first commit on the base's first-parent run. Empty
 * for a branch fast-forwarded into its base, whose commits are the base's now.
 */
export function highlightChain(commits: { hash: string; parents: string[] }[], tip: string, baseTip: string): Set<string> {
  const byHash = new Map(commits.map((x) => [x.hash, x]));
  const base = new Set<string>();
  for (let h: string | undefined = baseTip; h && byHash.has(h) && !base.has(h); h = byHash.get(h)!.parents[0]) base.add(h);
  const chain = new Set<string>();
  for (let h: string | undefined = tip; h && byHash.has(h) && !base.has(h) && !chain.has(h); h = byHash.get(h)!.parents[0]) chain.add(h);
  return chain;
}

/**
 * The line under the header saying where the highlighted branch stands, or null for none.
 * A branch on its base's tip reads "even with", not "merged": one just cut from its base
 * has nothing ahead, which is exactly what the server's `merged` flag (ahead === 0) also says.
 */
export function highlightSummary(h: GraphHighlight | null, isTicket: boolean): string | null {
  if (!h) return isTicket ? "No branch for this ticket yet" : null;
  if (!h.base) return h.branch;
  if (h.tip === h.baseTip) return `${h.branch} · even with ${h.base}`;
  if (h.merged) return `${h.branch} · merged into ${h.base}`;
  return `${h.branch} · ${h.ahead} ahead · ${h.behind} behind ${h.base}`;
}
