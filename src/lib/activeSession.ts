import type { SessionMeta, SessionState } from "@/server/types";

/**
 * Whether a session is still alive: starting/running/idle, plus needs-input — which is
 * a genuine block, but the tmux is still there and worth opening. done and failed are
 * finished.
 *
 * The single definition of the active-state set. `src/lib/terminalHeader.ts` delegates
 * its own same-named `isActiveSession(state: SessionState)` to this one rather than
 * repeating the four states — see the comment there. Its signature takes the bare
 * `SessionState`, not a full `SessionMeta`, so importing the wrong one for a given call
 * site is a type error, not a silent bug.
 */
export function isActiveState(state: SessionState): boolean {
  return state === "starting" || state === "running"
    || state === "idle" || state === "needs-input";
}

/**
 * Whether a session is still alive — see isActiveState for the definition. Shared by
 * the Sessions filter, the Kill/Dismiss label and activeSessionLevel, each of which
 * used to spell the same four states out for itself.
 */
export function isActiveSession(s: SessionMeta): boolean {
  return isActiveState(s.state);
}
