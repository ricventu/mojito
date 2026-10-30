// Closing the commit sheet lands on the graph, whichever view of the sheet is open, and never
// leaves the app. History is graph → details → diff when the sheet was opened from the graph, so
// the diff closes two steps back; anything it cannot vouch for is replaced with the graph instead.
// Entries are told by react-router's history index (0 = the tab's first entry, kept across a
// replace), never by `location.key`: a replace gives the first entry a fresh key.

/** Carried by a file link's push: whether the details entry under the diff has the graph behind it. */
export interface DiffEntryState {
  gitDetailsOverGraph: boolean;
}

/** The state a file link pushes, from the details entry's history index. */
export function diffEntryState(detailsIndex: number): DiffEntryState {
  return { gitDetailsOverGraph: detailsIndex > 0 };
}

export type CloseMove = { kind: "back"; steps: number } | { kind: "replace" };

/** How to close the sheet from the entry at history `index` (with its `state`), showing the diff when `diff`. */
export function closeMove(diff: boolean, index: number, state: unknown): CloseMove {
  if (index <= 0) return { kind: "replace" };
  if (!diff) return { kind: "back", steps: 1 };
  const overGraph =
    typeof state === "object" && state !== null && (state as Partial<DiffEntryState>).gitDetailsOverGraph === true;
  return overGraph && index >= 2 ? { kind: "back", steps: 2 } : { kind: "replace" };
}
