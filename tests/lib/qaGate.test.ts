import { describe, it, expect } from "vitest";
import { qaGateModel } from "@/lib/qaGate";

describe("qaGateModel", () => {
  it("offers nothing while the merge state is unknown", () => {
    expect(qaGateModel("checking")).toEqual({ approve: false, markDone: false, checking: true });
  });

  // Re-running a merge that already happened is a no-op at best, and a ticket that never took
  // a branch has nothing to merge at all. Both leave the status write as the only action.
  it("offers only mark-done when there is nothing to merge", () => {
    expect(qaGateModel("nothing-to-merge")).toEqual({ approve: false, markDone: true, checking: false });
  });

  it("offers the two approves for a branch with commits to land", () => {
    expect(qaGateModel("mergeable")).toEqual({ approve: true, markDone: false, checking: false });
  });
});
