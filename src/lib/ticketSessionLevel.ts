import type { SessionMeta } from "@/server/types";

export type ActiveLevel = "attn" | "run";

/**
 * The active-session level for a ticket, or null when it has none.
 * "attn" (needs input) outranks "run" (running/starting). done/failed are ignored.
 * Only sessions whose `ticket` matches are considered.
 */
export function activeSessionLevel(
  ticket: string,
  sessions: SessionMeta[],
): ActiveLevel | null {
  let level: ActiveLevel | null = null;
  for (const ssn of sessions) {
    if (ssn.ticket !== ticket) continue;
    if (ssn.state === "needs-input") return "attn"; // highest priority — done early
    if (ssn.state === "running" || ssn.state === "starting") level = "run";
  }
  return level;
}
