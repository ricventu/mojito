import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSelfUpdateEnabled,
  runSelfUpdate,
  signalProdSupervisor,
  supervisorPidPath,
  _resetSelfUpdate,
} from "@/server/selfUpdate";
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
    const noop = async () => {};
    const d1 = deferredPull();
    const p1 = runSelfUpdate(d1.pull, noop);
    d1.release({ status: "up-to-date", from: "aaa", to: "aaa" });
    await p1;
    const d2 = deferredPull();
    runSelfUpdate(d2.pull, noop);
    expect(d2.calls()).toBe(1);
    d2.release({ status: "up-to-date", from: "aaa", to: "aaa" });
  });

  it("clears the in-flight slot when the pull rejects", async () => {
    const failing = () => Promise.reject(new Error("boom"));
    await expect(runSelfUpdate(failing)).rejects.toThrow("boom");
    // A subsequent call must be able to start again (slot cleared in finally).
    const d = deferredPull();
    runSelfUpdate(d.pull, async () => {});
    expect(d.calls()).toBe(1);
    d.release({ status: "up-to-date", from: "a", to: "a" });
  });
});

// The macOS deploy trigger. `kill` is injected so the suite never actually signals a
// process, but the pid file is read off a real disk: parsing and the liveness probe are
// the whole point of this function.
describe("signalProdSupervisor", () => {
  const root = () => mkdtempSync(join(tmpdir(), "mojito-supervisor-"));
  function recorder(onProbe?: () => void) {
    const sent: [number, NodeJS.Signals | 0][] = [];
    const kill = (pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) onProbe?.();
      sent.push([pid, signal]);
    };
    return { kill, sent };
  }

  it("probes the recorded pid, then sends it SIGUSR2", async () => {
    const dir = root();
    writeFileSync(supervisorPidPath(dir), "4242\n");
    const r = recorder();
    await signalProdSupervisor(dir, r.kill);
    expect(r.sent).toEqual([[4242, 0], [4242, "SIGUSR2"]]);
  });

  it("fails when there is no pid file — nothing was started by `make prod`", async () => {
    const r = recorder();
    await expect(signalProdSupervisor(root(), r.kill)).rejects.toThrow(/no prod supervisor/i);
    expect(r.sent).toEqual([]);
  });

  it("fails when the recorded process is gone instead of signalling a stale pid", async () => {
    const dir = root();
    writeFileSync(supervisorPidPath(dir), "4242");
    const r = recorder(() => { throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" }); });
    await expect(signalProdSupervisor(dir, r.kill)).rejects.toThrow(/no prod supervisor/i);
    // The probe failed, so SIGUSR2 must never have gone out — to 4242 or anyone else.
    expect(r.sent.some(([, signal]) => signal === "SIGUSR2")).toBe(false);
  });

  it("fails when the pid file does not hold a pid", async () => {
    const dir = root();
    writeFileSync(supervisorPidPath(dir), "not-a-pid");
    const r = recorder();
    await expect(signalProdSupervisor(dir, r.kill)).rejects.toThrow(/no prod supervisor/i);
    expect(r.sent).toEqual([]);
  });
});

describe("runSelfUpdate deploy trigger", () => {
  it("triggers the deploy when already up to date (no merge, so no post-merge hook)", async () => {
    let calls = 0;
    const res = await runSelfUpdate(
      async () => ({ status: "up-to-date", from: "a", to: "a" }),
      async () => { calls += 1; },
    );
    expect(res).toEqual({ status: "up-to-date", from: "a", to: "a" });
    expect(calls).toBe(1);
  });

  // A real update deploys too: on macOS the prod supervisor watches no files (a pulled
  // commit triggers nothing by itself), and this checkout has no post-merge hook at all.
  it("triggers the deploy on a real update as well", async () => {
    let calls = 0;
    await runSelfUpdate(
      async () => ({ status: "updated", from: "a", to: "b" }),
      async () => { calls += 1; },
    );
    expect(calls).toBe(1);
  });

  it("does not trigger the deploy when the pull fails", async () => {
    let calls = 0;
    await expect(
      runSelfUpdate(() => Promise.reject(new Error("boom")), async () => { calls += 1; }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(0);
  });
});
