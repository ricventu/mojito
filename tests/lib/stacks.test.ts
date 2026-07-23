import { describe, it, expect } from "vitest";
import { pullMessage, syntheticStackSession } from "@/lib/stacks";

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

describe("syntheticStackSession", () => {
  it("builds a SessionMeta whose id is the stack tmux name", () => {
    const s = syntheticStackSession("factorybook", "Factorybook");
    expect(s.id).toBe("stack-factorybook");
    expect(s.kind).toBe("custom");
    expect(s.title).toContain("Factorybook");
  });
});
