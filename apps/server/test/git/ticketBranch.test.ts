import { describe, expect, it } from "vitest";
import type { RefEntry } from "../../src/git/graph";
import { findTicketBranch } from "../../src/git/ticketBranch";

const ref = (name: string, kind: "local" | "remote" | "tag", { hash = "aaa", date = 0, worktree = false } = {}): RefEntry => ({
  hash,
  ref: worktree ? { name, kind, worktree: true } : { name, kind },
  date,
});

const found = (names: string[], ticket = "RIC-505") => findTicketBranch(names.map((n) => ref(n, "local")), ticket)?.name ?? null;

describe("findTicketBranch matching", () => {
  it("takes the ticket as a whole token of the branch name, whatever its case", () => {
    expect(found(["ricventu/ric-505-git-graph"])).toBe("ricventu/ric-505-git-graph");
    expect(found(["RIC-505"])).toBe("RIC-505");
    expect(found(["fix/ric-505"])).toBe("fix/ric-505");
    expect(found(["ric-505.v2"])).toBe("ric-505.v2");
  });

  it("skips names that only contain it", () => {
    expect(found(["ric-5050"])).toBeNull();
    expect(found(["xric-505"])).toBeNull();
    expect(found(["ric-50"])).toBeNull();
  });

  it("never answers a tag", () => {
    expect(findTicketBranch([ref("ric-505", "tag")], "RIC-505")).toBeNull();
  });

  it("answers a remote branch under its full origin/ name", () => {
    expect(findTicketBranch([ref("origin/ric-505-x", "remote", { hash: "bbb" })], "RIC-505")).toEqual({ name: "origin/ric-505-x", hash: "bbb" });
  });

  it("matches a remote on the part after origin/, so the remote's own name is no match", () => {
    expect(findTicketBranch([ref("origin/main", "remote")], "origin-1")).toBeNull();
    expect(findTicketBranch([ref("origin/origin-1", "remote")], "origin-1")?.name).toBe("origin/origin-1");
  });

  it("does not read the ticket as a pattern", () => {
    expect(found(["abc-1"], "a.c-1")).toBeNull();
    expect(found(["a.c-1"], "a.c-1")).toBe("a.c-1");
    expect(found(["aab-1"], "a+b-1")).toBeNull();
    expect(found(["a+b-1"], "a+b-1")).toBe("a+b-1");
    expect(found(["fix/(a)-1"], "(a)-1")).toBe("fix/(a)-1");
  });
});

describe("findTicketBranch pick", () => {
  it("prefers a local branch over its origin/ twin", () => {
    const entries = [ref("origin/ric-505-a", "remote", { date: 9 }), ref("ric-505-a", "local", { date: 1 })];
    expect(findTicketBranch(entries, "RIC-505")?.name).toBe("ric-505-a");
  });

  it("prefers a worktree branch over a newer one without", () => {
    const entries = [ref("ric-505-new", "local", { date: 9 }), ref("ric-505-wt", "local", { date: 1, worktree: true })];
    expect(findTicketBranch(entries, "RIC-505")?.name).toBe("ric-505-wt");
  });

  it("prefers the more recent of two plain locals", () => {
    const entries = [ref("ric-505-old", "local", { date: 1 }), ref("ric-505-new", "local", { date: 2 })];
    expect(findTicketBranch(entries, "RIC-505")?.name).toBe("ric-505-new");
  });

  it("falls back to the name, so the answer is stable", () => {
    const entries = [ref("ric-505-b", "local", { date: 5 }), ref("ric-505-a", "local", { date: 5 })];
    expect(findTicketBranch(entries, "RIC-505")?.name).toBe("ric-505-a");
  });
});
