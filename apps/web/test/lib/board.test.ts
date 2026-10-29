import { describe, expect, it } from "vitest";
import type { BoardTickets, ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";
import { groupBoard, linearBanner, needsInput, sessionForTicket } from "@/lib/board";

const project = (name: string): ProjectRow => ({ name, path: `/repos/${name}`, teamKey: "RIC" });

function ticket(identifier: string, statusName: string, projectName: string | null = "Alpha"): TicketSummary {
  return {
    identifier,
    title: `title ${identifier}`,
    url: `https://linear.app/x/issue/${identifier}`,
    statusName,
    statusType: "started",
    project: projectName,
    labels: [],
    assignedToMe: false,
  };
}

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

describe("groupBoard", () => {
  it("orders active tickets In Review, In Progress, Todo, then other states, by numeric id", () => {
    const [section] = groupBoard(
      [project("Alpha")],
      [
        ticket("RIC-10", "Todo"),
        ticket("RIC-9", "Todo"),
        ticket("RIC-3", "Triage"),
        ticket("RIC-4", "In Progress"),
        ticket("RIC-12", "In Review"),
        ticket("RIC-2", "In Review"),
      ],
      [],
    );
    expect(section.active.map((t) => t.identifier)).toEqual(["RIC-2", "RIC-12", "RIC-4", "RIC-9", "RIC-10", "RIC-3"]);
  });

  it("keeps Backlog tickets apart from the active ones", () => {
    const [section] = groupBoard(
      [project("Alpha")],
      [ticket("RIC-1", "Backlog"), ticket("RIC-2", "Todo"), ticket("RIC-10", "Backlog"), ticket("RIC-3", "Backlog")],
      [],
    );
    expect(section.active.map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(section.backlog.map((t) => t.identifier)).toEqual(["RIC-1", "RIC-3", "RIC-10"]);
  });

  it("makes one section per project, alphabetically, tickets under their own project", () => {
    const sections = groupBoard(
      [project("Zeta"), project("Alpha")],
      [ticket("RIC-1", "Todo", "Zeta"), ticket("RIC-2", "Todo", "Alpha")],
      [],
    );
    expect(sections.map((s) => s.project)).toEqual(["Alpha", "Zeta"]);
    expect(sections[0].active.map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(sections[1].active.map((t) => t.identifier)).toEqual(["RIC-1"]);
  });

  it("keeps a project with no tickets when it has a free session, newest first", () => {
    const [section] = groupBoard(
      [project("Alpha")],
      [],
      [
        session("mj-alpha-aaaaaa", { createdAt: 1 }),
        session("mj-alpha-bbbbbb", { createdAt: 5, kind: "shell" }),
      ],
    );
    expect(section.active).toEqual([]);
    expect(section.loose.map((s) => s.id)).toEqual(["mj-alpha-bbbbbb", "mj-alpha-aaaaaa"]);
  });

  it("hangs a ticket session off its card, not off the loose rows, while the ticket is on the board", () => {
    const [section] = groupBoard(
      [project("Alpha")],
      [ticket("RIC-1", "Todo")],
      [session("mj-RIC-1", { kind: "ticket", ticket: "RIC-1", createdAt: 9 })],
    );
    expect(section.loose).toEqual([]);
  });

  // A ticket that left the open list (Done, Canceled, moved, past the first 100) must not take
  // its session off the board with it: a live tmux stays reachable, an ended row removable.
  it("lists a ticket session whose ticket is not on the board as a loose row of its project, any state", () => {
    const [section] = groupBoard(
      [project("Alpha")],
      [ticket("RIC-2", "Todo")],
      [
        session("mj-RIC-1", { kind: "ticket", ticket: "RIC-1", state: "running", createdAt: 9 }),
        session("mj-RIC-3", { kind: "ticket", ticket: "RIC-3", state: "ended", createdAt: 7 }),
        session("mj-alpha-aaaaaa", { createdAt: 8 }),
      ],
    );
    expect(section.project).toBe("Alpha");
    expect(section.loose.map((s) => s.id)).toEqual(["mj-RIC-1", "mj-alpha-aaaaaa", "mj-RIC-3"]);
  });

  it("puts an orphaned ticket session with no known project in General", () => {
    const sections = groupBoard(
      [project("Alpha")],
      [],
      [
        session("mj-RIC-5", { kind: "ticket", ticket: "RIC-5", project: null }),
        session("mj-RIC-6", { kind: "ticket", ticket: "RIC-6", project: "Gone" }),
      ],
    );
    expect(sections.map((s) => s.project)).toEqual([null]);
    expect(sections[0].loose.map((s) => s.id).sort()).toEqual(["mj-RIC-5", "mj-RIC-6"]);
  });

  // The ticket is listed but its project has no section, so it has no card either.
  it("treats a ticket listed under an unmapped project as not on the board", () => {
    const sections = groupBoard(
      [project("Alpha")],
      [ticket("RIC-7", "Todo", "Gone")],
      [session("mj-RIC-7", { kind: "ticket", ticket: "RIC-7", project: "Gone" })],
    );
    expect(sections.map((s) => s.project)).toEqual([null]);
    expect(sections[0].loose.map((s) => s.id)).toEqual(["mj-RIC-7"]);
  });

  it("puts project-less free sessions in a trailing General section", () => {
    const sections = groupBoard(
      [project("Alpha")],
      [ticket("RIC-1", "Todo")],
      [session("mj-general-aaaaaa", { project: null })],
    );
    expect(sections.map((s) => s.project)).toEqual(["Alpha", null]);
    expect(sections[1].loose).toHaveLength(1);
  });

  it("gives a free session whose project left the map a place in General", () => {
    const sections = groupBoard([project("Alpha")], [], [session("mj-gone-aaaaaa", { project: "Gone" })]);
    expect(sections.map((s) => s.project)).toEqual([null]);
  });

  it("omits General without loose sessions and projects with nothing in them", () => {
    const sections = groupBoard(
      [project("Alpha"), project("Beta")],
      [ticket("RIC-1", "Todo", "Beta")],
      [session("mj-RIC-1", { kind: "ticket", ticket: "RIC-1", project: "Beta" })],
    );
    expect(sections.map((s) => s.project)).toEqual(["Beta"]);
  });

  it("keeps a project that only has Backlog tickets", () => {
    const sections = groupBoard([project("Alpha")], [ticket("RIC-1", "Backlog")], []);
    expect(sections).toHaveLength(1);
  });
});

describe("sessionForTicket", () => {
  it("prefers a live session over a more recent ended one", () => {
    const sessions = [
      session("ended", { ticket: "RIC-1", kind: "ticket", state: "ended", lastEventAt: 20 }),
      session("idle", { ticket: "RIC-1", kind: "ticket", state: "idle", lastEventAt: 10 }),
    ];
    expect(sessionForTicket(sessions, "RIC-1")?.id).toBe("idle");
  });

  it("falls back to the most recent ended one", () => {
    const sessions = [
      session("old", { ticket: "RIC-1", kind: "ticket", state: "ended", lastEventAt: 1 }),
      session("new", { ticket: "RIC-1", kind: "ticket", state: "ended", lastEventAt: 2 }),
    ];
    expect(sessionForTicket(sessions, "RIC-1")?.id).toBe("new");
  });

  it("is null when the ticket has no session", () => {
    expect(sessionForTicket([session("x", { ticket: "RIC-2" })], "RIC-1")).toBeNull();
  });
});

describe("needsInput", () => {
  it("lists needs-input sessions, longest waiting first", () => {
    const sessions = [
      session("a", { state: "needs-input", lastEventAt: 30 }),
      session("b", { state: "running", lastEventAt: 1 }),
      session("c", { state: "needs-input", lastEventAt: 10 }),
    ];
    expect(needsInput(sessions).map((s) => s.id)).toEqual(["c", "a"]);
  });
});

describe("linearBanner", () => {
  const base: BoardTickets = { tickets: [], fetchedAt: null, stale: false, error: null };

  it("is silent when Linear answered", () => {
    expect(linearBanner({ ...base, fetchedAt: 1 })).toBeNull();
  });

  it("names the time of the last good data when the list is stale", () => {
    const at = new Date(2026, 9, 28, 9, 5).getTime();
    expect(linearBanner({ ...base, fetchedAt: at, stale: true, error: "boom" })).toBe(
      "Linear unreachable — data from 09:05",
    );
  });

  it("gives the error when there never was any data", () => {
    expect(linearBanner({ ...base, error: "401 unauthorized" })).toBe("Linear unreachable: 401 unauthorized");
  });
});
