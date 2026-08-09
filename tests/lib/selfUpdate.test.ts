import { describe, it, expect } from "vitest";
import { selfUpdateMessage } from "@/lib/selfUpdate";

describe("selfUpdateMessage", () => {
  it("updated -> ok with from/to", () => {
    expect(selfUpdateMessage({ status: "updated", from: "aaa", to: "bbb" }))
      .toEqual({ kind: "ok", text: "Updated aaa → bbb." });
  });
  it("up-to-date -> ok, still redeploying", () => {
    expect(selfUpdateMessage({ status: "up-to-date", from: "aaa", to: "aaa" }))
      .toEqual({ kind: "ok", text: "Already up to date (aaa) — redeploying." });
  });
  it("diverged -> err telling the user to use a terminal", () => {
    const m = selfUpdateMessage({ error: "diverged", detail: "Not possible to fast-forward" });
    expect(m.kind).toBe("err");
    expect(m.text).toBe("History diverged — resolve from a terminal — Not possible to fast-forward");
  });
  it("failed -> err with the detail", () => {
    expect(selfUpdateMessage({ error: "failed", detail: "network down" }))
      .toEqual({ kind: "err", text: "Update failed — network down" });
  });
  it("failed with no detail -> err", () => {
    expect(selfUpdateMessage({ error: "failed" })).toEqual({ kind: "err", text: "Update failed" });
  });
});
