// Canonical lifecycle-status presentation metadata: display order + color hue.
// Kept in sync with src/server/statusModel.ts (KNOWN_STATUSES) by tests/lib/status.test.ts.
// Hue keys map to `.badge.<hue>` rules in src/app/globals.css.

export const STATUS_ORDER: Record<string, number> = {
  Backlog: 0,
  Todo: 1,
  "In Progress": 2,
  "To QA": 3,
  Done: 4,
  Canceled: 5,
  Duplicate: 6,
};

/**
 * Synthetic non-lifecycle status for custom sessions (see sessionFilter, which
 * re-exports this). It is intentionally absent from STATUS_ORDER/STATUS_COLOR
 * (which mirror Linear lifecycle states); its rank falls through to "last" and
 * its hue is handled explicitly in statusColorClass.
 */
export const CUSTOM_STATUS = "Custom";

/**
 * Synthetic non-lifecycle status for plain-terminal (shell) sessions, parallel to
 * CUSTOM_STATUS. Absent from STATUS_ORDER/STATUS_COLOR; its rank falls through to
 * "last" and its hue is handled explicitly in statusColorClass.
 */
export const TERMINAL_STATUS = "Terminal";

export const STATUS_COLOR: Record<string, string> = {
  Backlog: "grey",
  Todo: "grey",
  "In Progress": "blue",
  "To QA": "amber",
  Done: "green",
  Canceled: "red",
  Duplicate: "muted",
};

/** Rank for ordering status groups; unknown statuses sort last. */
export function statusRank(name: string): number {
  return STATUS_ORDER[name] ?? Number.MAX_SAFE_INTEGER;
}

/** Badge color-hue class for a status; custom and terminal sessions each get
 *  their own hue, other unknown statuses are muted. */
export function statusColorClass(name: string): string {
  if (name === CUSTOM_STATUS) return "pink";
  if (name === TERMINAL_STATUS) return "term";
  return STATUS_COLOR[name] ?? "muted";
}
