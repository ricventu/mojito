import { describe, it, expect } from "vitest";
import { gitPush, GitPushError, type GitRun } from "@/server/gitPush";

// A fake runner: `branch` is what `rev-parse --abbrev-ref HEAD` reports; `remote`
// answers each `rev-parse --short origin/<branch>` (call 1 = before the push, call 2 =
// after); `push` decides what `git push` does. Every invocation is recorded in `calls`.
function fakeRun(opts: {
  branch?: string;
  remote?: (call: number) => Promise<string>;
  push?: () => Promise<void>;
  calls?: string[][];
}): GitRun {
  let remoteCalls = 0;
  return async (args) => {
    opts.calls?.push(args);
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
      return { stdout: `${opts.branch ?? "main"}\n`, stderr: "" };
    }
    if (args[0] === "rev-parse") {
      remoteCalls += 1;
      const sha = await (opts.remote ?? (() => Promise.resolve("aaaaaaa")))(remoteCalls);
      return { stdout: `${sha}\n`, stderr: "" };
    }
    if (args[0] === "push") {
      await (opts.push ?? (() => Promise.resolve()))();
      return { stdout: "", stderr: "" };
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

const shas = (before: string, after: string) => (call: number) =>
  Promise.resolve(call === 1 ? before : after);
function gitFail(stderr: string) {
  return () => Promise.reject(Object.assign(new Error("git failed"), { stderr }));
}

describe("gitPush", () => {
  it("reports pushed when the remote ref moves", async () => {
    const res = await gitPush("/repo", fakeRun({ remote: shas("aaaaaaa", "bbbbbbb") }));
    expect(res).toEqual({ status: "pushed", branch: "main", from: "aaaaaaa", to: "bbbbbbb" });
  });

  it("reports up-to-date when the remote ref is unchanged", async () => {
    const res = await gitPush("/repo", fakeRun({ remote: shas("aaaaaaa", "aaaaaaa") }));
    expect(res).toEqual({ status: "up-to-date", branch: "main", from: "aaaaaaa", to: "aaaaaaa" });
  });

  it("treats a branch with no remote counterpart as a new remote branch", async () => {
    const remote = (call: number) =>
      call === 1
        ? Promise.reject(new Error("fatal: ambiguous argument 'origin/main'"))
        : Promise.resolve("bbbbbbb");
    const res = await gitPush("/repo", fakeRun({ remote }));
    expect(res).toEqual({ status: "pushed", branch: "main", from: "", to: "bbbbbbb" });
  });

  it("pushes the checked-out branch by name and never forces", async () => {
    const calls: string[][] = [];
    await gitPush("/repo", fakeRun({ branch: "feature/x", remote: shas("a", "b"), calls }));
    expect(calls).toContainEqual(["push", "origin", "feature/x"]);
    expect(calls.flat().some((a) => a.startsWith("--force"))).toBe(false);
  });

  it("refuses a detached HEAD without pushing", async () => {
    const calls: string[][] = [];
    const err = await gitPush("/repo", fakeRun({ branch: "HEAD", calls })).catch((e) => e);
    expect(err).toBeInstanceOf(GitPushError);
    expect(err.kind).toBe("detached");
    expect(calls.some((c) => c[0] === "push")).toBe(false);
  });

  it("maps a non-fast-forward refusal to rejected", async () => {
    const run = fakeRun({
      remote: shas("a", "a"),
      push: gitFail(" ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs"),
    });
    await expect(gitPush("/repo", run)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("maps the 'Updates were rejected' hint to rejected", async () => {
    const run = fakeRun({
      remote: shas("a", "a"),
      push: gitFail("hint: Updates were rejected because the remote contains work that you do"),
    });
    await expect(gitPush("/repo", run)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("maps a protected-branch [remote rejected] to failed, not rejected", async () => {
    const run = fakeRun({
      remote: shas("a", "a"),
      push: gitFail(" ! [remote rejected] main -> main (protected branch hook declined)"),
    });
    const err = await gitPush("/repo", run).catch((e) => e);
    expect(err.kind).toBe("failed");
    expect(err.detail).toContain("protected branch");
  });

  it("maps any other git failure to failed and keeps an output snippet", async () => {
    const run = fakeRun({ remote: shas("a", "a"), push: gitFail("fatal: could not read Username") });
    const err = await gitPush("/repo", run).catch((e) => e);
    expect(err).toBeInstanceOf(GitPushError);
    expect(err.kind).toBe("failed");
    expect(err.detail).toContain("could not read Username");
  });
});
