import { stageOf } from "./autoAdvance.js";

// Status → the lime stage skill that handles it. Derived from stageOf (the same map
// auto-advance uses) so the status list cannot drift from the lifecycle model. Terminal
// stages (6) and unknown statuses fall back to the /lime-next dispatcher, which no-ops
// politely — older lime versions and custom states keep working.
const SLASH_OF_STAGE: Record<number, string> = {
  1: "/lime-design",
  2: "/lime-implement",
  3: "/lime-review",
  4: "/lime-qa",
  5: "/lime-merge",
};

export function slashForStatus(status: string): string {
  const stage = stageOf(status);
  return (stage !== undefined && SLASH_OF_STAGE[stage]) || "/lime-next";
}
