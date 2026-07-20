// Canonical lifecycle-status presentation metadata: display order + color hue.
// Kept in sync with src/server/autoAdvance.ts (STAGE_OF) by tests/lib/status.test.ts.
// Hue keys map to `.badge.<hue>` rules in src/app/globals.css.

export const STATUS_ORDER: Record<string, number> = {
  Backlog: 0,
  Todo: 1,
  "To Code": 2,
  "To Review": 3,
  "To QA": 4,
  "To Merge": 5,
  Done: 6,
  Canceled: 7,
  Duplicate: 8,
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
  "To Code": "blue",
  "To Review": "indigo",
  "To QA": "amber",
  "To Merge": "teal",
  Done: "green",
  Canceled: "red",
  Duplicate: "muted",
};

/** Rank for ordering status groups; unknown statuses sort last. */
export function statusRank(name: string): number {
  return STATUS_ORDER[name] ?? Number.MAX_SAFE_INTEGER;
}

/** Badge color-hue class for a status; custom sessions get their own hue,
 *  other unknown statuses are muted. */
export function statusColorClass(name: string): string {
  if (name === CUSTOM_STATUS) return "pink";
  if (name === TERMINAL_STATUS) return "term";
  return STATUS_COLOR[name] ?? "muted";
}
