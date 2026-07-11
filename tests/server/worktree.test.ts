import { describe, it, expect } from "vitest";
import { parseWorktrees, matchWorktree } from "@/server/worktree";

const PORCELAIN = `worktree /code/lime
HEAD abc
branch refs/heads/main

worktree /code/lime-RIC-46
HEAD def
branch refs/heads/ric-46-add-thing
`;

describe("worktree parsing", () => {
  it("parses porcelain output", () => {
    const wts = parseWorktrees(PORCELAIN);
    expect(wts).toHaveLength(2);
    expect(wts[1]).toEqual({ path: "/code/lime-RIC-46", branch: "ric-46-add-thing" });
  });
  it("matches a worktree by ticket id (case-insensitive)", () => {
    const wts = parseWorktrees(PORCELAIN);
    expect(matchWorktree(wts, "RIC-46")).toBe("/code/lime-RIC-46");
    expect(matchWorktree(wts, "RIC-99")).toBeNull();
  });
});
