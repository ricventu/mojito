import type { SessionMeta } from "@/server/types";

/**
 * Whether a session is still alive: starting/running/idle, plus needs-input — which is
 * a genuine block, but the tmux is still there and worth opening. done and failed are
 * finished.
 *
 * One definition, shared by the Sessions filter, the Kill/Dismiss label and
 * activeSessionLevel, each of which used to spell the same four states out for itself.
 */
export function isActiveSession(s: SessionMeta): boolean {
  return s.state === "starting" || s.state === "running"
    || s.state === "idle" || s.state === "needs-input";
}
