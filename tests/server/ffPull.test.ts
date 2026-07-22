import { describe, it, expect } from "vitest";
import { ffPull, FfPullError, type GitRun } from "@/server/ffPull";

// A fake runner: `pull` decides what `git pull --ff-only` does; rev-parse returns
// `before` then `after`. Records the cwd it was called with.
function fakeRun(opts: {
  before: string;
  after: string;
  pull: () => Promise<void>;
  seenCwd?: string[];
}): GitRun {
  let revCalls = 0;
  return async (args, cwd) => {
    opts.seenCwd?.push(cwd);
    if (args[0] === "rev-parse") {
      revCalls += 1;
      return { stdout: `${revCalls === 1 ? opts.before : opts.after}\n`, stderr: "" };
    }
    if (args[0] === "pull") {
      await opts.pull();
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const ok = () => Promise.resolve();
function gitFail(stderr: string) {
  return () => Promise.reject(Object.assign(new Error("git failed"), { stderr }));
}

describe("ffPull", () => {
  it("reports updated when HEAD moves", async () => {
    const res = await ffPull("/wt", fakeRun({ before: "aaaaaaa", after: "bbbbbbb", pull: ok }));
    expect(res).toEqual({ status: "updated", from: "aaaaaaa", to: "bbbbbbb" });
  });

  it("reports up-to-date when HEAD is unchanged", async () => {
    const res = await ffPull("/wt", fakeRun({ before: "aaaaaaa", after: "aaaaaaa", pull: ok }));
    expect(res).toEqual({ status: "up-to-date", from: "aaaaaaa", to: "aaaaaaa" });
  });

  it("passes the cwd through to git", async () => {
    const seenCwd: string[] = [];
    await ffPull("/some/checkout", fakeRun({ before: "a", after: "b", pull: ok, seenCwd }));
    expect(seenCwd.every((c) => c === "/some/checkout")).toBe(true);
    expect(seenCwd.length).toBeGreaterThan(0);
  });

  it("maps the 'Not possible to fast-forward' failure to diverged", async () => {
    const run = fakeRun({ before: "a", after: "a", pull: gitFail("hint: ...\nfatal: Not possible to fast-forward, aborting.") });
    await expect(ffPull("/wt", run)).rejects.toMatchObject({ kind: "diverged" });
  });

  it("maps the 'Need to specify how to reconcile' failure to diverged", async () => {
    const run = fakeRun({ before: "a", after: "a", pull: gitFail("fatal: Need to specify how to reconcile divergent branches.") });
    await expect(ffPull("/wt", run)).rejects.toMatchObject({ kind: "diverged" });
  });

  it("maps any other git failure to failed and keeps a stderr snippet", async () => {
    const run = fakeRun({ before: "a", after: "a", pull: gitFail("fatal: not a git repository") });
    const err = await ffPull("/wt", run).catch((e) => e);
    expect(err).toBeInstanceOf(FfPullError);
    expect(err.kind).toBe("failed");
    expect(err.detail).toContain("not a git repository");
  });
});
