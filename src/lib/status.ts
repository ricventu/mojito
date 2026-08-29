// Canonical lifecycle-status presentation metadata: display order + color hue.
// Kept in sync with src/server/statusModel.ts (KNOWN_STATUSES) by tests/lib/status.test.ts.
// Hue keys map to `.badge.<hue>` rules in src/app/globals.css.

/**
 * The status the board hides by default (RIC-275). Named rather than spelled out at
 * each of its three call sites, all of which have to agree for the exclusion to reach
 * tickets and sessions alike.
 */
export const BACKLOG_STATUS = "Backlog";

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

/**
 * Synthetic non-lifecycle status for the New-ticket intake session (RIC-251), parallel to
 * CUSTOM_STATUS. It reads as a status name rather than a session kind because that is the
 * slot it occupies — the board's own group divider and one of the status filter's chips —
 * and "New ticket" is what the human pressed to get it. Absent from
 * STATUS_ORDER/STATUS_COLOR; its rank falls through to "last" and its hue is handled
 * explicitly in statusColorClass.
 */
export const INTAKE_STATUS = "New ticket";

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

/** Badge color-hue class for a status; custom, intake and terminal sessions each get
 *  their own hue, other unknown statuses are muted. */
export function statusColorClass(name: string): string {
  if (name === CUSTOM_STATUS) return "pink";
  if (name === TERMINAL_STATUS) return "term";
  // indigo is already declared for lifecycle badges and mapped to no status, so the
  // intake bucket gets a hue of its own without a new token.
  if (name === INTAKE_STATUS) return "indigo";
  return STATUS_COLOR[name] ?? "muted";
}

/**
 * The status the launch sheet offers to move this ticket to by hand, or `null` when it
 * offers none — the presentation half of MANUAL_STATUSES (src/server/statusModel.ts),
 * kept in sync with it by tests/lib/status.test.ts.
 *
 * A toggle rather than a picker: the pair is its own inverse, so the button says where
 * it goes instead of asking.
 */
export function manualMoveTarget(status: string): string | null {
  if (status === BACKLOG_STATUS) return "Todo";
  if (status === "Todo") return BACKLOG_STATUS;
  return null;
}
