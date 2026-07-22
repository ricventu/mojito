// Tracks a deploy health poll. The deploy is async, so the server may still answer
// 200 for a few seconds after the pull returns; we must see it go DOWN and then come
// back UP before reloading. `recovered` latches so later flaps don't unset it.
export interface PollState {
  sawDown: boolean;
  recovered: boolean;
}

export const initialPollState: PollState = { sawDown: false, recovered: false };

export function nextPollState(state: PollState, up: boolean): PollState {
  if (state.recovered) return state;
  if (!up) return { sawDown: true, recovered: false };
  return { sawDown: state.sawDown, recovered: state.sawDown };
}
