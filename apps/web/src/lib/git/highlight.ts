// What the highlighted branch covers and the strip text that says where it stands.

import type { GraphHighlight } from "@mojito/shared";

/**
 * The branch's own commits within the loaded window: its first-parent run from `tip` down to
 * (excluding) the first commit on the base's first-parent run. Empty for a branch fast-forwarded
 * into the base (its commits are the base's now) and for one cut at the base tip.
 */
export function highlightChain(
  commits: { hash: string; parents: string[] }[],
  tip: string,
  baseTip: string,
): Set<string> {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const run = (from: string, stop: (h: string) => boolean): Set<string> => {
    const seen = new Set<string>();
    for (let h: string | undefined = from; h && byHash.has(h) && !stop(h) && !seen.has(h); h = byHash.get(h)!.parents[0]) {
      seen.add(h);
    }
    return seen;
  };
  const base = run(baseTip, () => false);
  return run(tip, (h) => base.has(h));
}

/**
 * The chain the page draws: none without a highlight or without a base. With no base there is
 * nothing to measure against, so the whole first-parent line would count as the branch's own and
 * every side branch would be dimmed.
 */
export function highlightedCommits(
  commits: { hash: string; parents: string[] }[],
  h: GraphHighlight | null,
): Set<string> {
  return h && h.base ? highlightChain(commits, h.tip, h.baseTip) : new Set();
}

/**
 * The strip under the header, or null for none. "Even with" is decided by comparing tips: the
 * server's `merged` (ahead = 0) cannot tell a fresh branch from a merged one. The checkout view
 * (no ticket) never says "merged": a local branch 0 ahead of its upstream is only behind it.
 */
export function highlightSummary(h: GraphHighlight | null, ticket: string | null): string | null {
  if (!h) return ticket ? `No branch for ${ticket}` : null;
  if (!h.base) return h.branch;
  if (h.tip === h.baseTip) return `${h.branch} · even with ${h.base}`;
  if (h.merged && ticket !== null) return `${h.branch} · merged into ${h.base}`;
  return `${h.branch} · ${h.ahead} ahead · ${h.behind} behind ${h.base}`;
}
