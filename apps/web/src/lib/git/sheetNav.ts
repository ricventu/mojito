// Closing the commit sheet lands on the graph, whichever view of the sheet is open, and never
// leaves the app. History is graph → details → diff when the sheet was opened from the graph, so
// the diff closes two steps back; anything it cannot vouch for is replaced with the graph instead.

/** react-router's key for the entry a tab was opened on: nothing of ours is behind it. */
const FIRST_ENTRY = "default";

/** Carried by a file link's push: whether the details entry under the diff has the graph behind it. */
export interface DiffEntryState {
  gitDetailsOverGraph: boolean;
}

/** The state a file link pushes, from the details entry's own key. */
export function diffEntryState(detailsKey: string): DiffEntryState {
  return { gitDetailsOverGraph: detailsKey !== FIRST_ENTRY };
}

export type CloseMove = { kind: "back"; steps: number } | { kind: "replace" };

/** How to close the sheet from the entry at `key` (with its history `state`), showing the diff when `diff`. */
export function closeMove(diff: boolean, key: string, state: unknown): CloseMove {
  if (key === FIRST_ENTRY) return { kind: "replace" };
  if (!diff) return { kind: "back", steps: 1 };
  const overGraph =
    typeof state === "object" && state !== null && (state as Partial<DiffEntryState>).gitDetailsOverGraph === true;
  return overGraph ? { kind: "back", steps: 2 } : { kind: "replace" };
}
