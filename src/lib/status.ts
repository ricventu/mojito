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

/** Badge color-hue class for a status; unknown statuses are muted. */
export function statusColorClass(name: string): string {
  return STATUS_COLOR[name] ?? "muted";
}
