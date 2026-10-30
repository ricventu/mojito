import type { GraphRow, Segment } from "@/lib/git/layout";

const LANE = 12;
const DOT = 4;

const x = (lane: number) => lane * LANE + LANE / 2;

/** A straight line within a lane, else a cubic that leaves and arrives vertically. */
function path({ from, to }: Segment, y1: number, y2: number): string {
  if (from === to) return `M ${x(from)} ${y1} V ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M ${x(from)} ${y1} C ${x(from)} ${mid}, ${x(to)} ${mid}, ${x(to)} ${y2}`;
}

/**
 * One row of the graph: the segments entering from above end at the dot, those leaving it run to
 * the row's bottom edge, so stacked rows of the same `height` join into continuous lanes.
 */
export function GraphLanes({
  row,
  cols,
  height,
  highlighted,
}: {
  row: GraphRow;
  cols: number;
  height: number;
  highlighted: boolean;
}) {
  const mid = height / 2;
  return (
    <svg aria-hidden width={cols * LANE} height={height} className="shrink-0" fill="none" strokeWidth={2}>
      {row.top.map((s) => (
        <path key={`t${s.from}:${s.to}`} d={path(s, 0, mid)} stroke={`var(--graph-${s.color})`} />
      ))}
      {row.bottom.map((s) => (
        <path key={`b${s.from}:${s.to}`} d={path(s, mid, height)} stroke={`var(--graph-${s.color})`} />
      ))}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={DOT}
        fill={highlighted ? "var(--primary)" : `var(--graph-${row.color})`}
        stroke="var(--background)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
