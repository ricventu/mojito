import { describe, it, expect, afterEach } from "vitest";
import { isSelfUpdateEnabled, runSelfUpdate, _resetSelfUpdate } from "@/server/selfUpdate";
import type { FfPullResult } from "@/server/ffPull";

afterEach(() => {
  delete process.env.MOJITO_SELF_UPDATE;
  _resetSelfUpdate();
});

// A controllable pull: resolves only when we call `release`, and counts invocations.
function deferredPull() {
  let calls = 0;
  let release!: (r: FfPullResult) => void;
  const gate = new Promise<FfPullResult>((res) => { release = res; });
  const pull = () => { calls += 1; return gate; };
  return { pull, release, calls: () => calls };
}

describe("isSelfUpdateEnabled", () => {
  it("is true only when the flag equals '1'", () => {
    process.env.MOJITO_SELF_UPDATE = "1";
    expect(isSelfUpdateEnabled()).toBe(true);
    process.env.MOJITO_SELF_UPDATE = "0";
    expect(isSelfUpdateEnabled()).toBe(false);
    delete process.env.MOJITO_SELF_UPDATE;
    expect(isSelfUpdateEnabled()).toBe(false);
  });
});

describe("runSelfUpdate single-flight", () => {
  it("shares one in-flight pull between concurrent callers", async () => {
    const d = deferredPull();
    const a = runSelfUpdate(d.pull);
    const b = runSelfUpdate(d.pull);
    expect(d.calls()).toBe(1); // second caller did not start a new pull
    d.release({ status: "updated", from: "aaa", to: "bbb" });
    expect(await a).toEqual({ status: "updated", from: "aaa", to: "bbb" });
    expect(await b).toEqual({ status: "updated", from: "aaa", to: "bbb" });
  });

  it("allows a fresh pull once the previous one settles", async () => {
    const d1 = deferredPull();
    const p1 = runSelfUpdate(d1.pull);
    d1.release({ status: "up-to-date", from: "aaa", to: "aaa" });
    await p1;
    const d2 = deferredPull();
    runSelfUpdate(d2.pull);
    expect(d2.calls()).toBe(1);
    d2.release({ status: "up-to-date", from: "aaa", to: "aaa" });
  });

  it("clears the in-flight slot when the pull rejects", async () => {
    const failing = () => Promise.reject(new Error("boom"));
    await expect(runSelfUpdate(failing)).rejects.toThrow("boom");
    // A subsequent call must be able to start again (slot cleared in finally).
    const d = deferredPull();
    runSelfUpdate(d.pull);
    expect(d.calls()).toBe(1);
    d.release({ status: "up-to-date", from: "a", to: "a" });
  });
});
