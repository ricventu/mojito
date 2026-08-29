// The authoritative Linear lifecycle status model: work happens in Backlog/Todo/In
// Progress, To QA is the human-approval gate, and every ticket ends in one of the
// terminal states. Kept in sync with src/lib/status.ts (STATUS_ORDER/STATUS_COLOR) by
// tests/lib/status.test.ts, and with src/lib/stageDefaults.ts (LAUNCHABLE_STATUSES) by
// tests/lib/stageDefaults.test.ts.
export const WORK_STATES = ["Backlog", "Todo", "In Progress"];
export const GATE_STATES = ["To QA"];
export const TERMINAL_STATES = ["Done", "Canceled", "Duplicate"];

// The authoritative set of lifecycle status names. Consumed by src/lib/status.ts's
// sync-guard test so status metadata cannot drift from the model.
export const KNOWN_STATUSES: string[] = [...WORK_STATES, ...GATE_STATES, ...TERMINAL_STATES];

/**
 * The two statuses a human may move a ticket between by hand (RIC-275).
 *
 * Every other transition in the lifecycle is Mojito's own — a launch writes In
 * Progress, the session's result file writes To QA, a QA verdict writes Done — and each
 * carries preconditions the status alone cannot express. Backlog and Todo are the pair
 * nothing moves between on its own, which is why they are the pair offered by hand, and
 * why /api/tickets/[id]/status validates against this list rather than KNOWN_STATUSES:
 * an open target would be a way to write Done over unmerged work.
 *
 * Mirrored for presentation by manualMoveTarget in src/lib/status.ts, tied to this list
 * by tests/lib/status.test.ts.
 */
export const MANUAL_STATUSES: string[] = ["Backlog", "Todo"];
