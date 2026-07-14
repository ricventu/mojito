import { statusRank } from "@/lib/status";

/**
 * Bucket items by their status string and return the buckets ordered by lifecycle
 * rank (unknown statuses last, alphabetical tie-break). Item order within each bucket
 * is the input order; the input array is not mutated.
 */
export function groupByStatus<T>(
  items: T[],
  getStatus: (item: T) => string,
): { status: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const status = getStatus(item);
    const bucket = buckets.get(status);
    if (bucket) bucket.push(item);
    else buckets.set(status, [item]);
  }
  return Array.from(buckets, ([status, groupItems]) => ({ status, items: groupItems }))
    .sort((a, b) => {
      const byRank = statusRank(a.status) - statusRank(b.status);
      return byRank !== 0 ? byRank : a.status.localeCompare(b.status);
    });
}
