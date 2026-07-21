// Diff-size thresholds for review-depth scaling. Shared between the server logic
// (src/server/reviewScale.ts) and UI copy (Settings hints), so the numbers a user
// reads in the form can never drift from the ones the launch path applies.
export const SMALL_DIFF_LINES = 150;
export const MEDIUM_DIFF_LINES = 400;
