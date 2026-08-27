import { describe, it, expect } from "vitest";
import { projectActions, stackFor } from "@/lib/projectToolbar";
import type { StackRow } from "@/lib/stacks";

function row(over: Partial<StackRow> = {}): StackRow {
  return {
    project: "Factorybook",
    slug: "factorybook",
    hasStack: true,
    status: "stopped",
    pullable: true,
    self: false,
    hasWorktreeScript: true,
    ...over,
  };
}

describe("stackFor", () => {
  it("finds the row naming the section's project", () => {
    const rows = [row(), row({ project: "Lime", slug: "lime" })];
    expect(stackFor(rows, "Lime")?.slug).toBe("lime");
  });

  // The NO_PROJECT bucket and a project projects.json has since dropped both reach the
  // board as section names with no repo behind them.
  it("is null for a section no mapped project answers for", () => {
    expect(stackFor([row()], "No project")).toBeNull();
    expect(stackFor([], "Factorybook")).toBeNull();
  });
});

describe("projectActions", () => {
  it("has nothing to offer a section with no stack row", () => {
    expect(projectActions(null, true)).toEqual([]);
  });

  it("offers start/stop/logs plus git on a stopped stack", () => {
    expect(projectActions(row(), false)).toEqual(["start", "stop", "logs", "pull", "push"]);
  });

  it("drops Start once the stack is running, and keeps Stop", () => {
    expect(projectActions(row({ status: "running" }), false))
      .toEqual(["stop", "logs", "pull", "push"]);
  });

  // Detection can read "crashed" while orphan processes still hold the ports.
  it("keeps Stop on a crashed stack", () => {
    expect(projectActions(row({ status: "crashed" }), false))
      .toEqual(["start", "stop", "logs", "pull", "push"]);
  });

  it("offers only the git actions to a project with no start.sh", () => {
    expect(projectActions(row({ hasStack: false, status: null }), false))
      .toEqual(["pull", "push"]);
  });

  // The self-row's pull is the guarded self-update flow, never the raw one.
  it("replaces Pull with Pull & deploy on the server's own checkout", () => {
    const self = row({ project: "Mojito", slug: "mojito", pullable: false, self: true, hasStack: false, status: null });
    expect(projectActions(self, true)).toEqual(["deploy", "push"]);
  });

  it("hides Pull & deploy when the server does not expose self-update", () => {
    const self = row({ project: "Mojito", slug: "mojito", pullable: false, self: true, hasStack: false, status: null });
    expect(projectActions(self, false)).toEqual(["push"]);
  });

  it("offers Create worktree script only while the repo has none", () => {
    expect(projectActions(row({ hasWorktreeScript: false, hasStack: false, status: null }), false))
      .toEqual(["pull", "push", "init-script"]);
    expect(projectActions(row({ hasWorktreeScript: true, hasStack: false, status: null }), false))
      .not.toContain("init-script");
  });
});
