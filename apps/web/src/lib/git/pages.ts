// The loaded graph pages as one list of commits.

import type { GitGraphPage, GraphCommit, GraphRef } from "@mojito/shared";

/**
 * Pages are read with `--skip=N` over live refs, so commits landing after page 1 shift the log:
 * the next page then starts with rows already shown. The first occurrence is kept (its position
 * is the one the earlier rows were laid out against), every repeat is dropped. The next page's
 * skip still counts raw page lengths, which is what the server's `--skip` means.
 */
export function pageCommits(pages: GitGraphPage[]): GraphCommit[] {
  const seen = new Set<string>();
  const out: GraphCommit[] = [];
  for (const page of pages) {
    for (const c of page.commits) {
      if (seen.has(c.hash)) continue;
      seen.add(c.hash);
      out.push(c);
    }
  }
  return out;
}

/**
 * The refs on `hash` (full, or abbreviated as a pasted link may have it) among the loaded commits.
 * None when it is not loaded, or when an abbreviation matches more than one.
 */
export function refsOf(commits: GraphCommit[], hash: string): GraphRef[] {
  let found: GraphCommit | null = null;
  for (const c of commits) {
    if (!c.hash.startsWith(hash)) continue;
    if (found) return [];
    found = c;
  }
  return found?.refs ?? [];
}
