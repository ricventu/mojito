import { describe, it, expect } from "vitest";
import { pullMessage, pushMessage, syntheticStackSession } from "@/lib/stacks";

describe("pullMessage", () => {
  it("updated -> ok with from/to", () => {
    expect(pullMessage({ status: "updated", from: "aaa", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Updated aaa → bbb.", canResolve: false });
  });
  it("up-to-date -> ok", () => {
    expect(pullMessage({ status: "up-to-date", from: "aaa", to: "aaa" }))
      .toEqual({ kind: "ok", text: "Already up to date (aaa).", canResolve: false });
  });
  it("diverged -> err offering resolve", () => {
    const m = pullMessage({ error: "diverged", detail: "Not possible to fast-forward" });
    expect(m.kind).toBe("err");
    expect(m.canResolve).toBe(true);
    expect(m.text).toMatch(/diverged/i);
  });
  it("failed -> err offering resolve", () => {
    expect(pullMessage({ error: "failed", detail: "network down" }).canResolve).toBe(true);
  });
});

describe("pushMessage", () => {
  it("pushed -> ok with branch and from/to", () => {
    expect(pushMessage({ status: "pushed", branch: "main", from: "aaa", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Pushed main aaa → bbb." });
  });
  it("pushed with no previous remote ref -> ok naming it a new branch", () => {
    expect(pushMessage({ status: "pushed", branch: "main", from: "", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Pushed main (new remote branch)." });
  });
  it("up-to-date -> ok", () => {
    expect(pushMessage({ status: "up-to-date", branch: "main", from: "aaa", to: "aaa" }))
      .toEqual({ kind: "ok", text: "Nothing to push (main at aaa)." });
  });
  it("rejected -> err pointing at Pull", () => {
    const m = pushMessage({ error: "rejected", detail: "! [rejected] main -> main" });
    expect(m.kind).toBe("err");
    expect(m.text).toMatch(/Pull first/);
    expect(m.text).toContain("! [rejected] main -> main");
  });
  it("detached -> err", () => {
    expect(pushMessage({ error: "detached", detail: "repo is on a detached HEAD" }))
      .toEqual({ kind: "err", text: "Repo is on a detached HEAD — nothing to push." });
  });
  it("failed -> err with the detail", () => {
    expect(pushMessage({ error: "failed", detail: "could not read Username" }))
      .toEqual({ kind: "err", text: "Push failed — could not read Username" });
  });
  it("failed with no detail -> err", () => {
    expect(pushMessage({ error: "failed" })).toEqual({ kind: "err", text: "Push failed" });
  });
});

describe("syntheticStackSession", () => {
  it("builds a SessionMeta whose id is the stack tmux name", () => {
    const s = syntheticStackSession("factorybook", "Factorybook");
    expect(s.id).toBe("stack-factorybook");
    expect(s.kind).toBe("custom");
    expect(s.title).toContain("Factorybook");
  });
});
