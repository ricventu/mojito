import { describe, it, expect } from "vitest";
import { projectActions, projectLinks, stackFor } from "@/lib/projectToolbar";
import type { StackRow } from "@/lib/stacks";

function row(over: Partial<StackRow> = {}): StackRow {
  return {
    project: "Factorybook",
    slug: "factorybook",
    path: "/repo/fb",
    hasStack: true,
    status: "stopped",
    pullable: true,
    self: false,
    hasWorktreeScript: true,
    ...over,
  };
}

// The four that lead every mapped project's row: the terminal header's two links to the
// repo root, and the board's two creation sheets.
const HEAD = ["warp", "vscode", "ticket", "session"] as const;

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
    expect(projectActions(row(), false)).toEqual([...HEAD, "start", "stop", "logs", "pull", "push", "claude-deploy"]);
  });

  it("drops Start once the stack is running, and keeps Stop", () => {
    expect(projectActions(row({ status: "running" }), false))
      .toEqual([...HEAD, "stop", "logs", "pull", "push", "claude-deploy"]);
  });

  // Detection can read "crashed" while orphan processes still hold the ports.
  it("keeps Stop on a crashed stack", () => {
    expect(projectActions(row({ status: "crashed" }), false))
      .toEqual([...HEAD, "start", "stop", "logs", "pull", "push", "claude-deploy"]);
  });

  it("offers only the git actions to a project with no start.sh", () => {
    expect(projectActions(row({ hasStack: false, status: null }), false))
      .toEqual([...HEAD, "pull", "push", "claude-deploy"]);
  });

  // The self-row's pull is the guarded self-update flow, never the raw one.
  it("replaces Pull with Pull & deploy on the server's own checkout", () => {
    const self = row({ project: "Mojito", slug: "mojito", pullable: false, self: true, hasStack: false, status: null });
    expect(projectActions(self, true)).toEqual([...HEAD, "deploy", "push", "claude-deploy"]);
  });

  it("hides Pull & deploy when the server does not expose self-update", () => {
    const self = row({ project: "Mojito", slug: "mojito", pullable: false, self: true, hasStack: false, status: null });
    expect(projectActions(self, false)).toEqual([...HEAD, "push", "claude-deploy"]);
  });

  it("offers Create worktree script only while the repo has none", () => {
    expect(projectActions(row({ hasWorktreeScript: false, hasStack: false, status: null }), false))
      .toEqual([...HEAD, "pull", "push", "claude-deploy", "init-script"]);
    expect(projectActions(row({ hasWorktreeScript: true, hasStack: false, status: null }), false))
      .not.toContain("init-script");
  });

  // A repo can always take either, and both sheets' Project field only accepts a name
  // /api/projects offers — which is exactly the set that has a stack row here.
  it("offers both creation sheets on every mapped project, whatever its stack and git state", () => {
    expect(projectActions(row(), true)).toEqual(expect.arrayContaining(["ticket", "session"]));
    expect(projectActions(row({ hasStack: false, status: null, pullable: false, self: true }), false))
      .toEqual(expect.arrayContaining(["ticket", "session"]));
  });

  // Mojito does not know any repo's deploy procedure, so it has no signal to hide the
  // action on: the session it opens is what finds out. It is the confirm in the
  // component, not this list, that keeps a mistap from reaching production.
  it("offers Deploy with Claude on every mapped project, alongside the self-row's own deploy", () => {
    expect(projectActions(row(), false)).toContain("claude-deploy");
    const self = row({ project: "Mojito", slug: "mojito", pullable: false, self: true });
    expect(projectActions(self, true)).toEqual(
      expect.arrayContaining(["deploy", "claude-deploy"]),
    );
  });

  // The links are the one thing a projects.json entry can be silently wrong about: a
  // relative path would open whatever directory the receiving app considers current.
  it("drops Warp and VS Code when the mapped path is not absolute", () => {
    expect(projectActions(row({ path: "relative/repo" }), false))
      .toEqual(["ticket", "session", "start", "stop", "logs", "pull", "push", "claude-deploy"]);
    expect(projectActions(row({ path: "" }), false)).not.toContain("warp");
  });
});

describe("projectLinks", () => {
  it("points both at the mapped repo root", () => {
    expect(projectLinks(row())).toEqual({
      warp: "warp://action/new_tab?path=%2Frepo%2Ffb",
      vscode: "vscode://file/repo/fb/",
    });
  });

  it("has nothing for a section with no mapped repo", () => {
    expect(projectLinks(null)).toEqual({ warp: "", vscode: "" });
  });
});
