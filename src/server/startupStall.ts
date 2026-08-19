import type { Registry } from "./registry.js";
import type { EventBus } from "./events.js";

/**
 * How long a launch may sit at "starting" before Mojito stops believing it is merely booting.
 * Claude Code fires SessionStart within a couple of seconds of coming up, so anything past
 * this is not a slow boot — and if it somehow is, the hook that finally arrives maps straight
 * back to "running" (mapHook/mapCustomHook), so the worst case self-corrects.
 */
export const STALL_GRACE_MS = 20_000;

export interface StallDeps {
  registry: Registry;
  // Absent = no watch: the flip would be invisible anyway, since the client refetches the
  // session list only on an event and a stalled launch emits none of its own.
  bus?: EventBus;
  // Same probe the launchers use for their duplicate check, asked again after the grace
  // period — this time to tell "alive but not talking" from "never came up".
  hasSession: (name: string) => Promise<boolean>;
  stallGraceMs?: number;
  scheduleStall?: (fn: () => void, ms: number) => void;
}

const STALL_MESSAGE = "claude has not started — open its terminal";

function defaultSchedule(fn: () => void, ms: number): void {
  const timer = setTimeout(fn, ms);
  // A pending stall check must never be the reason the process stays up.
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Watch a freshly launched session out of its transient "starting" state.
 *
 * Every state Mojito shows comes from a Claude Code hook, and the first one (SessionStart)
 * only fires once claude has actually booted. Anything that blocks it before that leaves no
 * hook at all and the session pinned at "starting" forever — RIC-222, where the blocker is
 * the workspace-trust prompt ("Is this a project you trust?"). A "General" custom session
 * runs in the home directory, whose trust answer Claude Code does not persist, so that one
 * hit the prompt on *every* launch and never left "starting" once.
 *
 * The honest state for a launch nobody has heard from is needs-input: something in that
 * terminal wants the human. So after the grace period, a session still at "starting" whose
 * tmux is alive is flipped there and alerted on, which is the same signal a permission
 * prompt raises — open the terminal and answer it.
 */
export function watchStartupStall(id: string, deps: StallDeps): void {
  const bus = deps.bus;
  if (!bus) return;
  const schedule = deps.scheduleStall ?? defaultSchedule;
  schedule(() => { void settle(id, deps, bus); }, deps.stallGraceMs ?? STALL_GRACE_MS);
}

async function settle(id: string, deps: StallDeps, bus: EventBus): Promise<void> {
  const meta = deps.registry.get(id);
  if (!meta || meta.state !== "starting") return; // a hook has spoken — nothing to say
  // Not a human-input problem, and not this module's to report: a dead tmux belongs to
  // Registry.recover (boot) and sweepOrphans, which drop it rather than badge it.
  if (!(await deps.hasSession(id))) return;
  deps.registry.patch(id, { state: "needs-input", message: STALL_MESSAGE });
  bus.emit({ type: "session.state", id, state: "needs-input" });
  bus.emit({ type: "session.alert", id, kind: "needs-input", ticket: meta.ticket, message: STALL_MESSAGE });
}
