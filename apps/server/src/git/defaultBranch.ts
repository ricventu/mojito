import type { RefEntry } from "./graph";

/**
 * The branch a ticket branch is measured against: `originHead` (what `origin/HEAD` points at,
 * `origin/main`), else `origin/main`, `origin/master`, then a local `main`, `master` — the first
 * that is among the refs and is not `branch` itself. Null when none is, and the strip names the
 * branch alone. Tags never count.
 */
export function defaultBase(entries: RefEntry[], originHead: string | null, branch: string): { name: string; hash: string } | null {
  const candidates = [originHead, "origin/main", "origin/master", "main", "master"];
  for (const name of candidates) {
    if (!name || name === branch) continue;
    const found = entries.find((e) => e.ref.kind !== "tag" && e.ref.name === name);
    if (found) return { name, hash: found.hash };
  }
  return null;
}
