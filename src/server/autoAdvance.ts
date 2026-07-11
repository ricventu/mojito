export type AdvanceDecision = { action: "stop" } | { action: "gate"; gate: string } | { action: "launch" };

export const GATE_STATES = ["To QA", "To Merge"];
export const TERMINAL_STATES = ["Done", "Canceled", "Duplicate"];

export function decideAutoAdvance(newStatus: string, autoAdvance: boolean): AdvanceDecision {
  if (!autoAdvance) return { action: "stop" };
  if (TERMINAL_STATES.includes(newStatus)) return { action: "stop" };
  if (GATE_STATES.includes(newStatus)) return { action: "gate", gate: newStatus };
  return { action: "launch" };
}
