import type { SessionMeta } from "@/server/types";

// Compare two ISO timestamp strings, newest first. Plain string compare is
// chronological for identical ISO-8601 formatting.
function newerFirst(a: string, b: string): number {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

/**
 * Order a project group's sessions: cluster by ticket, newest-first within each
 * cluster and across clusters. Equal createdAt tie-breaks by id, descending.
 * Returns a new array; does not mutate the input.
 */
export function orderSessions(items: SessionMeta[]): SessionMeta[] {
  const clusters = new Map<string, SessionMeta[]>();
  for (const s of items) {
    const arr = clusters.get(s.ticket);
    if (arr) arr.push(s);
    else clusters.set(s.ticket, [s]);
  }

  const bySessionDesc = (a: SessionMeta, b: SessionMeta) =>
    newerFirst(a.createdAt, b.createdAt) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  const ordered = [...clusters.entries()].map(([ticket, arr]) => {
    const sorted = [...arr].sort(bySessionDesc);
    return { ticket, sorted, newest: sorted[0].createdAt }; // sorted[0] is newest
  });

  ordered.sort(
    (a, b) =>
      newerFirst(a.newest, b.newest) ||
      (a.ticket < b.ticket ? 1 : a.ticket > b.ticket ? -1 : 0),
  );

  return ordered.flatMap((c) => c.sorted);
}
