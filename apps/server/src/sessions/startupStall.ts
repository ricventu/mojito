import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";

/**
 * How long a launch may sit at "starting" before Mojito stops believing it is merely booting.
 * Claude Code fires SessionStart within a couple of seconds of coming up; if a boot really is
 * that slow, the SessionStart that finally arrives maps straight back to "running".
 */
export const STALL_GRACE_MS = 20_000;

const STALL_ALERT = "open the terminal and answer";

export interface StallDeps {
  sessions: SessionsRepo;
  bus: EventBus;
  hasSession(name: string): Promise<boolean>;
  setTimeout?: typeof setTimeout;
}

/**
 * Watch a freshly launched claude session out of "starting" (RIC-222).
 *
 * Every live state comes from a Claude Code hook, and the first one (SessionStart) fires only
 * once claude has booted. Whatever blocks it before that — in practice the workspace-trust
 * prompt — leaves no hook at all and the session pinned at "starting". The honest state for a
 * launch nobody has heard from is needs-input, so after the grace period a session still at
 * "starting" whose tmux is alive is flipped there with an alert. A session a hook has spoken
 * for is left alone, and so is one whose tmux is gone: that is reconciliation's to end.
 */
export function watchStartupStall(id: string, deps: StallDeps): void {
  const schedule = deps.setTimeout ?? setTimeout;
  // A tmux that cannot be asked leaves the session as it is: not knowing is no reason to flip it.
  const timer = schedule(
    () => void settle(id, deps).catch((err) => console.error(`startup stall check for ${id} failed:`, err)),
    STALL_GRACE_MS,
  );
  // A pending stall check must never be the reason the process stays up.
  (timer as { unref?: () => void } | undefined)?.unref?.();
}

async function settle(id: string, deps: StallDeps): Promise<void> {
  const before = deps.sessions.get(id);
  if (!before || before.state !== "starting") return;
  if (!(await deps.hasSession(id))) return;
  // Re-read after the await: a hook may have arrived while tmux was being asked.
  if (deps.sessions.get(id)?.state !== "starting") return;
  const session = deps.sessions.patch(id, { state: "needs-input", alert: STALL_ALERT });
  if (session) deps.bus.emit({ type: "session.updated", session });
}
