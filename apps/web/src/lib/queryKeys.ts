export const qk = {
  tickets: ["tickets"],
  sessions: ["sessions"],
  tasks: ["tasks"],
  projects: ["projects"],
  settings: ["settings"],
} as const;

/** Every favourites write, queued in one mutation scope so the PUTs run one at a time. */
export const favoritesMutationKey = ["favorites"] as const;

/**
 * The git page's queries. Deliberately not in `qk`: `useEvents` invalidates every `qk` value on
 * each (re)connect, and the graph is a snapshot — rows jumping under the reader is worse than
 * being one fetch behind. Reload and a successful Pull/Push refresh it explicitly.
 */
export const gitKeys = {
  graphs: (project: string) => ["git", project, "graph"] as const,
  graph: (project: string, ticket: string | null) => ["git", project, "graph", ticket] as const,
  commit: (project: string, hash: string) => ["git", project, "commit", hash] as const,
  diff: (project: string, hash: string, file: string, from: string | null) =>
    ["git", project, "diff", hash, file, from] as const,
};
