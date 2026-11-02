import { describe, expect, it } from "vitest";
import type { ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";
import { groupBoard } from "@/lib/board";
import { isCurrent, sessionCount, sessionLabel, sessionName, sidebarGroups } from "@/lib/sidebar";

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
    title: null,
    endReason: null,
    claudeSessionId: null,
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
  it("keeps ended sessions until removed, after the live ones, each part newest first", () => {
    const groups = sidebarGroups(
      [project("Alpha")],
      [
        session("mj-a-old-ended", { state: "ended", createdAt: 1 }),
        session("mj-a-live-old", { createdAt: 2 }),
        session("mj-a-new-ended", { state: "ended", createdAt: 9 }),
        session("mj-a-live-new", { state: "running", createdAt: 5 }),
      ],
    );
    expect(ids(groups)).toEqual(["mj-a-live-new", "mj-a-live-old", "mj-a-new-ended", "mj-a-old-ended"]);
  });

  it("shows a project whose sessions have all ended", () => {
    const groups = sidebarGroups([project("Alpha")], [session("mj-a-1", { state: "ended" })]);
    expect(groups.map((g) => g.project)).toEqual(["Alpha"]);
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

describe("sessionCount", () => {
  it("counts every group's sessions", () => {
    const groups = sidebarGroups(
      [project("Alpha"), project("Beta")],
      [session("mj-1", { project: "Alpha" }), session("mj-2", { project: "Beta" }), session("mj-3", { project: null })],
    );
    expect(sessionCount(groups)).toBe(3);
    expect(sessionCount([])).toBe(0);
  });

  it("counts only the live ones: an ended session is history", () => {
    const groups = sidebarGroups([project("Alpha")], [session("mj-1"), session("mj-2", { state: "ended" })]);
    expect(sessionCount(groups)).toBe(1);
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

describe("sessionName", () => {
  it("is claude's name for the session once it has one", () => {
    expect(sessionName(session("mj-mojito-a1b2c3", { title: "pippo-test" }))).toBe("pippo-test");
    expect(sessionName(session("mj-mojito-a1b2c3", { kind: "shell", title: "build" }))).toBe("build");
  });

  it("is the kind before that", () => {
    expect(sessionName(session("mj-mojito-a1b2c3"))).toBe("Claude");
    expect(sessionName(session("mj-mojito-a1b2c3", { kind: "shell" }))).toBe("Shell");
  });
});

describe("sessionLabel: a named session", () => {
  it("shows its name over the id's hex suffix", () => {
    expect(sessionLabel(session("mj-mojito-a1b2c3", { title: "pippo-test" }), [])).toEqual({
      primary: "pippo-test",
      secondary: "a1b2c3",
    });
  });

  it("a ticket session keeps its ticket, whatever claude calls it", () => {
    const s = session("mj-RIC-5", { kind: "ticket", ticket: "RIC-5", title: "Fix the login" });
    expect(sessionLabel(s, [ticket("RIC-5")])).toEqual({ primary: "RIC-5", secondary: "title RIC-5" });
  });
});

describe("a peer's sessions", () => {
  it("group by the peer's project names alone", () => {
    const groups = sidebarGroups([{ name: "Ios" }], [session("mj-RIC-7", { project: "Ios" }), session("mj-x", { project: null })]);
    expect(groups.map((g) => [g.project, ids([g])])).toEqual([
      ["Ios", ["mj-RIC-7"]],
      [null, ["mj-x"]],
    ]);
  });

  it("take their titles from the peer's ticket titles", () => {
    const s = session("mj-RIC-7", { kind: "ticket", ticket: "RIC-7" });
    expect(sessionLabel(s, [{ identifier: "RIC-7", title: "Ship it" }])).toEqual({ primary: "RIC-7", secondary: "Ship it" });
  });
});

describe("isCurrent", () => {
  it("matches host and id together", () => {
    expect(isCurrent({ host: null, id: "mj-a" }, null, "mj-a")).toBe(true);
    expect(isCurrent({ host: "mac", id: "mj-a" }, "mac", "mj-a")).toBe(true);
  });

  it("is not fooled by the same id on another host", () => {
    expect(isCurrent({ host: "mac", id: "mj-a" }, null, "mj-a")).toBe(false);
    expect(isCurrent({ host: null, id: "mj-a" }, "mac", "mj-a")).toBe(false);
  });

  it("is false with no session on screen or another id", () => {
    expect(isCurrent(undefined, null, "mj-a")).toBe(false);
    expect(isCurrent({ host: null, id: "mj-b" }, null, "mj-a")).toBe(false);
  });
});
