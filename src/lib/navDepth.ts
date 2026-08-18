/**
 * How many history entries the app itself pushed to reach the current one.
 *
 * Kept in `history.state` rather than a module variable so it survives a reload,
 * and so going back or forward several entries at once still reports the truth:
 * the browser hands back the state that belongs to the entry it landed on.
 */
const KEY = "mojitoDepth";

/** The depth stamped on a history entry; 0 for one the app never pushed. */
export function historyDepth(state: unknown): number {
  if (typeof state !== "object" || state === null) return 0;
  const depth = (state as Record<string, unknown>)[KEY];
  if (typeof depth !== "number" || !Number.isFinite(depth)) return 0;
  return Math.max(0, depth);
}

/**
 * Whether the previous history entry is one of the app's own.
 *
 * This is what lets an in-app back button call `history.back()` when it would
 * land inside the app, and navigate to a fallback url when it would not — a deep
 * link opened in a fresh tab has nothing behind it, so backing out of it would
 * leave Mojito entirely.
 */
export function canGoBack(state: unknown): boolean {
  return historyDepth(state) > 0;
}

/**
 * The state to stamp on the entry being pushed. Foreign keys are carried over
 * untouched: `history.state` is shared with whatever else writes to it.
 */
export function pushedState(current: unknown): Record<string, unknown> {
  const base = typeof current === "object" && current !== null ? current : {};
  return { ...base, [KEY]: historyDepth(current) + 1 };
}
