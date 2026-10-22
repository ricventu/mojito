// Tracks a deploy health poll. The deploy is async, so the server may still answer
// 200 for a few seconds after the pull returns: reload only once a NEW server answers.
// That is either a 200 after a failed probe, or a 200 from a different process than the
// one that answered before the deploy (`boot`, the /api/health `x-mojito-boot` header).
// The second is what catches a restart shorter than the poll interval — on Linux the
// build runs with the old server up and the restart is a few seconds, so the poll can
// miss the downtime entirely. `recovered` latches so later flaps don't unset it.
export interface PollState {
  boot: string | null;
  sawDown: boolean;
  recovered: boolean;
}

export interface HealthProbe {
  up: boolean;
  boot: string | null;
}

export function initialPollState(boot: string | null): PollState {
  return { boot, sawDown: false, recovered: false };
}

export function nextPollState(state: PollState, probe: HealthProbe): PollState {
  if (state.recovered) return state;
  if (!probe.up) return { ...state, sawDown: true };
  const restarted = state.boot !== null && probe.boot !== null && probe.boot !== state.boot;
  return { ...state, recovered: state.sawDown || restarted };
}

// One /api/health probe. Any failure, network included, reads as down.
export async function probeHealth(fetchHealth: () => Promise<Response>): Promise<HealthProbe> {
  try {
    const res = await fetchHealth();
    return { up: res.ok, boot: res.ok ? res.headers.get("x-mojito-boot") : null };
  } catch {
    return { up: false, boot: null };
  }
}
