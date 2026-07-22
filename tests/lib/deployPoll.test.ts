import { describe, it, expect } from "vitest";
import { initialPollState, nextPollState, type PollState } from "@/lib/deployPoll";

// Fold a sequence of health probe outcomes and return the final state.
const fold = (ups: boolean[]): PollState => ups.reduce(nextPollState, initialPollState);

describe("nextPollState", () => {
  it("does not recover while the server has only ever been up", () => {
    expect(fold([true, true, true])).toEqual({ sawDown: false, recovered: false });
  });

  it("records the server going down without recovering yet", () => {
    expect(fold([true, false])).toEqual({ sawDown: true, recovered: false });
  });

  it("recovers on the first success after a failure", () => {
    expect(fold([true, false, true])).toEqual({ sawDown: true, recovered: true });
  });

  it("stays recovered on later probes", () => {
    expect(fold([false, true, false, true])).toEqual({ sawDown: true, recovered: true });
  });

  it("tolerates several failures before recovery", () => {
    expect(fold([true, false, false, false, true])).toEqual({ sawDown: true, recovered: true });
  });
});
