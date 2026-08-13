// Which verdicts the To QA gate offers, given what the server says is left to merge. Pure so it
// can be tested without a render harness, following terminalHeadModel and holdsSheetOpen.
export type MergeState = "checking" | "nothing-to-merge" | "mergeable";

export interface QaGateModel {
  /** The two approve buttons, which run the server-side merge. */
  approve: boolean;
  /** The status-only verdict: the branch already landed, or there is no branch. */
  markDone: boolean;
  /** No verdict can be submitted yet — the merge state is still being read. */
  checking: boolean;
}

export function qaGateModel(state: MergeState): QaGateModel {
  return {
    approve: state === "mergeable",
    markDone: state === "nothing-to-merge",
    checking: state === "checking",
  };
}
