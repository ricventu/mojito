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
