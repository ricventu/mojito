export type AdvanceDecision = { action: "stop" } | { action: "gate"; gate: string } | { action: "launch" };

export const GATE_STATES = ["To QA", "To Merge"];
export const TERMINAL_STATES = ["Done", "Canceled", "Duplicate"];

// Map each Linear workflow status to the lifecycle stage (per lime-next's dispatch
// table) that handles it. Every stage after the first has exactly one entry status
// (stage 1 covers both Backlog and Todo), so a move to a LATER stage is a genuine
// handoff and a backward move (a QA reject: To QA -> To Code) is not.
const STAGE_OF: Record<string, number> = {
  Backlog: 1, Todo: 1,
  "To Code": 2,
  "To Review": 3,
  "To QA": 4,
  "To Merge": 5,
  Done: 6, Canceled: 6, Duplicate: 6,
};

// The authoritative set of lifecycle status names (keys of STAGE_OF). Consumed by
// src/lib/status.ts's sync-guard test so status metadata cannot drift from the model.
export const KNOWN_STATUSES: string[] = Object.keys(STAGE_OF);

export function stageOf(status: string): number | undefined {
  return STAGE_OF[status];
}

/**
 * True only when the ticket moved to a status handled by a LATER stage than the
 * one the session launched in — a genuine stage handoff. A same-stage move
 * (Backlog→Todo) or a backward move returns false. For statuses outside the known
 * workflow, falls back to raw inequality so custom states keep the previous behavior.
 */
export function stageAdvanced(fromStatus: string, toStatus: string): boolean {
  const from = stageOf(fromStatus);
  const to = stageOf(toStatus);
  if (from === undefined || to === undefined) return toStatus !== fromStatus;
  return to > from;
}

export function decideAutoAdvance(newStatus: string, autoAdvance: boolean): AdvanceDecision {
  if (!autoAdvance) return { action: "stop" };
  if (TERMINAL_STATES.includes(newStatus)) return { action: "stop" };
  if (GATE_STATES.includes(newStatus)) return { action: "gate", gate: newStatus };
  return { action: "launch" };
}
