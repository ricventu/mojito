import { describe, expect, it } from "vitest";
import type { ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";
import { groupBoard } from "@/lib/board";
import { sessionLabel, sidebarGroups, splitHidden } from "@/lib/sidebar";

const project = (name: string): ProjectRow => ({ name, path: `/repos/${name}`, teamKey: "RIC" });

function session(id: string, over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    kind: "claude",
    project: "Alpha",
    ticket: null,
    cwd: "/repos/Alpha",
    model: "opus",
    effort: "high",
    state: "idle",
    alert: null,
    createdAt: 1,
    lastEventAt: 1,
    hidden: false,
    ...over,
  };
}

function ticket(identifier: string): TicketSummary {
  return {
    identifier,
    title: `title ${identifier}`,
    url: `https://linear.app/x/issue/${identifier}`,
    statusName: "Todo",
    statusType: "unstarted",
    project: "Alpha",
    labels: [],
    assignedToMe: false,
  };
}

const ids = (groups: { sessions: SessionMeta[] }[]) => groups.flatMap((g) => g.sessions.map((s) => s.id));

describe("sidebarGroups", () => {
  it("excludes ended sessions", () => {
    const groups = sidebarGroups(
      [project("Alpha")],
      [session("mj-a-111111"), session("mj-a-222222", { state: "ended" })],
    );
    expect(ids(groups)).toEqual(["mj-a-111111"]);
  });

  it("groups configured projects alphabetically, General last", () => {
    const groups = sidebarGroups(
      [project("Beta"), project("Alpha")],
      [
        session("mj-1", { project: null }),
        session("mj-2", { project: "Beta" }),
        session("mj-3", { project: "Alpha" }),
      ],
    );
    expect(groups.map((g) => g.project)).toEqual(["Alpha", "Beta", null]);
  });

  it("orders groups exactly as the board orders its sections", () => {
    const names = ["beta", "Alpha", "émile", "Zeta", "alpha2"];
    const projects = names.map(project);
    const sessions = [...names, null].map((p, i) => session(`mj-${i}`, { project: p }));
    expect(sidebarGroups(projects, sessions).map((g) => g.project)).toEqual(
      groupBoard(projects, [], sessions).map((s) => s.project),
    );
  });

  it("an unmapped project goes to General", () => {
    const groups = sidebarGroups([project("Alpha")], [session("mj-1", { project: "Gone" })]);
    expect(groups).toEqual([{ project: null, sessions: [expect.objectContaining({ id: "mj-1" })] }]);
  });

  it("orders a group newest first, ties by id", () => {
    const groups = sidebarGroups(
      [project("Alpha")],
      [
        session("mj-b", { createdAt: 5 }),
        session("mj-old", { createdAt: 1 }),
        session("mj-a", { createdAt: 5 }),
        session("mj-new", { createdAt: 9 }),
      ],
    );
    expect(ids(groups)).toEqual(["mj-new", "mj-a", "mj-b", "mj-old"]);
  });

  it("a state change does not move a row", () => {
    const base = [
      session("mj-1", { createdAt: 3 }),
      session("mj-2", { createdAt: 2 }),
      session("mj-3", { createdAt: 1 }),
    ];
    const before = ids(sidebarGroups([project("Alpha")], base));
    const flipped = base.map((s) =>
      s.id === "mj-3" ? { ...s, state: "needs-input" as const, lastEventAt: 99 } : s,
    );
    expect(ids(sidebarGroups([project("Alpha")], flipped))).toEqual(before);
  });

  it("drops a group with no live session", () => {
    expect(sidebarGroups([project("Alpha"), project("Beta")], [session("mj-1")]).map((g) => g.project)).toEqual([
      "Alpha",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [session("mj-1", { createdAt: 1 }), session("mj-2", { createdAt: 2 })];
    sidebarGroups([project("Alpha")], input);
    expect(input.map((s) => s.id)).toEqual(["mj-1", "mj-2"]);
  });
});

describe("splitHidden", () => {
  it("keeps the grouping and drops empty groups", () => {
    const groups = sidebarGroups(
      [project("Alpha"), project("Beta")],
      [
        session("mj-1", { project: "Alpha" }),
        session("mj-2", { project: "Alpha", hidden: true }),
        session("mj-3", { project: "Beta", hidden: true }),
        session("mj-4", { project: null }),
      ],
    );
    const { shown, hidden } = splitHidden(groups);
    expect(shown.map((g) => [g.project, g.sessions.map((s) => s.id)])).toEqual([
      ["Alpha", ["mj-1"]],
      [null, ["mj-4"]],
    ]);
    expect(hidden.map((g) => [g.project, g.sessions.map((s) => s.id)])).toEqual([
      ["Alpha", ["mj-2"]],
      ["Beta", ["mj-3"]],
    ]);
  });
});

describe("sessionLabel", () => {
  const tickets = [ticket("RIC-5")];

  it("a ticket session shows the ticket id and its title", () => {
    expect(sessionLabel(session("mj-RIC-5", { kind: "ticket", ticket: "RIC-5" }), tickets)).toEqual({
      primary: "RIC-5",
      secondary: "title RIC-5",
    });
  });

  it("a ticket no longer in the list has no title", () => {
    expect(sessionLabel(session("mj-RIC-9", { kind: "ticket", ticket: "RIC-9" }), tickets)).toEqual({
      primary: "RIC-9",
      secondary: "",
    });
  });

  it("a claude session shows the id's hex suffix", () => {
    expect(sessionLabel(session("mj-mojito-a1b2c3"), tickets)).toEqual({
      primary: "Claude",
      secondary: "a1b2c3",
    });
  });

  it("a shell session is Shell", () => {
    expect(sessionLabel(session("mj-mojito-d4e5f6", { kind: "shell" }), tickets).primary).toBe("Shell");
  });
});
