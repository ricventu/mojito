export const qk = {
  tickets: ["tickets"],
  sessions: ["sessions"],
  tasks: ["tasks"],
  projects: ["projects"],
  settings: ["settings"],
  peers: ["peers"],
  /** Prefix of every project's worktree count (`worktreeKey`), so a reconnect re-reads them all. */
  worktrees: ["worktrees"],
} as const;

/** A project's linked worktree count, the Clean button's badge. */
export const worktreeKey = (project: string) => [...qk.worktrees, project] as const;

/** Every favourites write, queued in one mutation scope so the PUTs run one at a time. */
export const favoritesMutationKey = ["favorites"] as const;

/**
 * The git page's queries. Deliberately not in `qk`: `useEvents` invalidates every `qk` value on
 * each (re)connect, and the graph is a snapshot — rows jumping under the reader is worse than
 * being one fetch behind. Reload and a successful Pull/Push refresh it explicitly.
 */
export const gitKeys = {
  graphs: (host: string | null, project: string) => ["git", host ?? "", project, "graph"] as const,
  graph: (host: string | null, project: string, ticket: string | null) =>
    ["git", host ?? "", project, "graph", ticket] as const,
  commit: (host: string | null, project: string, hash: string) =>
    ["git", host ?? "", project, "commit", hash] as const,
  diff: (host: string | null, project: string, hash: string, file: string, from: string | null) =>
    ["git", host ?? "", project, "diff", hash, file, from] as const,
};

/**
 * The docs page's queries, outside `qk` for the same reason as `gitKeys`: a reconnect must not
 * re-read a document under the reader. Reload refreshes them explicitly.
 */
export const docKeys = {
  project: (host: string | null, project: string) => ["docs", host ?? "", project] as const,
  list: (host: string | null, project: string, ticket: string | null) =>
    ["docs", host ?? "", project, "list", ticket] as const,
  file: (host: string | null, project: string, ticket: string | null, path: string) =>
    ["docs", host ?? "", project, "file", ticket, path] as const,
};
