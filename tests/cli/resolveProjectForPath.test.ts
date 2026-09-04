import { describe, it, expect } from "vitest";
import { resolveProjectForPath } from "@/cli/resolveProjectForPath";

const projects = [
  { name: "Mojito", path: "/Users/me/code/Mojito/mojito" },
  { name: "Other", path: "/Users/me/code/other" },
];

describe("resolveProjectForPath", () => {
  it("names the project when the cwd is the mapped checkout itself, with no worktree", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/Mojito/mojito", mainRepo: "/Users/me/code/Mojito/mojito" },
      projects,
    )).toEqual({ projectName: "Mojito" });
  });

  it("carries the worktree when the cwd is a linked worktree of a mapped checkout", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/Mojito/mojito/.claude/worktrees/RIC-1-x", mainRepo: "/Users/me/code/Mojito/mojito" },
      projects,
    )).toEqual({ projectName: "Mojito", worktree: "/Users/me/code/Mojito/mojito/.claude/worktrees/RIC-1-x" });
  });

  it("sends no worktree when the mapped path IS the worktree the cwd sits in", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/other", mainRepo: "/Users/me/code/other-main" },
      projects,
    )).toEqual({ projectName: "Other" });
  });

  it("answers no project for a repo projects.json does not map", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/stranger", mainRepo: "/Users/me/code/stranger" },
      projects,
    )).toEqual({ projectName: null });
  });

  it("answers no project outside a git repo at all", () => {
    expect(resolveProjectForPath({ toplevel: null, mainRepo: null }, projects)).toEqual({ projectName: null });
  });

  it("falls back to the toplevel when git could not name the main checkout", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/Mojito/mojito", mainRepo: null },
      projects,
    )).toEqual({ projectName: "Mojito" });
  });

  it("tolerates a trailing slash on a projects.json path", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/other", mainRepo: "/Users/me/code/other" },
      [{ name: "Other", path: "/Users/me/code/other/" }],
    )).toEqual({ projectName: "Other" });
  });

  it("does not mistake a sibling directory for the mapped one on a shared prefix", () => {
    expect(resolveProjectForPath(
      { toplevel: "/Users/me/code/other-fork", mainRepo: "/Users/me/code/other-fork" },
      projects,
    )).toEqual({ projectName: null });
  });
});
