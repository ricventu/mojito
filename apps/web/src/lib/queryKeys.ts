export const qk = {
  tickets: ["tickets"],
  sessions: ["sessions"],
  tasks: ["tasks"],
  projects: ["projects"],
  settings: ["settings"],
} as const;

/** Every favourites write, queued in one mutation scope so the PUTs run one at a time. */
export const favoritesMutationKey = ["favorites"] as const;
