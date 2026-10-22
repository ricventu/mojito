import { describe, it, expect } from "vitest";
import { initialPollState, nextPollState, probeHealth, type HealthProbe, type PollState } from "@/lib/deployPoll";

const up = (boot: string | null = "old"): HealthProbe => ({ up: true, boot });
const down: HealthProbe = { up: false, boot: null };

// Fold a sequence of health probes, starting from the process seen before the deploy.
const fold = (probes: HealthProbe[], before: string | null = "old"): PollState =>
  probes.reduce(nextPollState, initialPollState(before));

describe("nextPollState", () => {
  it("does not recover while the old server is still the one answering", () => {
    expect(fold([up(), up(), up()]).recovered).toBe(false);
  });

  it("records the server going down without recovering yet", () => {
    expect(fold([up(), down])).toMatchObject({ sawDown: true, recovered: false });
  });

  it("recovers on the first success after a failure", () => {
    expect(fold([up(), down, up("new")]).recovered).toBe(true);
  });

  it("recovers when a new process answers, even if no probe saw the downtime", () => {
    // Linux: the build runs with the old server up, the restart is shorter than a poll.
    expect(fold([up(), up(), up("new")])).toMatchObject({ sawDown: false, recovered: true });
  });

  it("does not take an unknown boot id for a restart", () => {
    expect(fold([up(null), up("new")], null).recovered).toBe(false);
    expect(fold([up(null)]).recovered).toBe(false);
  });

  it("stays recovered on later probes", () => {
    expect(fold([down, up(), down, up()]).recovered).toBe(true);
  });

  it("tolerates several failures before recovery", () => {
    expect(fold([up(), down, down, down, up()]).recovered).toBe(true);
  });
});

describe("probeHealth", () => {
  it("reads the boot id of a healthy server", async () => {
    const res = new Response("ok", { headers: { "x-mojito-boot": "42-1" } });
    expect(await probeHealth(async () => res)).toEqual({ up: true, boot: "42-1" });
  });

  it("reads a failed response or a network error as down", async () => {
    expect(await probeHealth(async () => new Response("no", { status: 500 }))).toEqual(down);
    expect(await probeHealth(() => Promise.reject(new Error("offline")))).toEqual(down);
  });
});
