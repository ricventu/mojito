import { describe, it, expect } from "vitest";
import {
  buildUnifiedRows, groupByProject, orderTicketRows, mergedStatuses, mergedProjects,
  type TicketRow,
} from "@/lib/unifiedRows";
import { liveStatuses } from "@/lib/ticketFilter";
import type { SessionMeta, TicketSummary } from "@/server/types";

function ticket(p: Partial<TicketSummary>): TicketSummary {
  return {
    identifier: "RIC-1",
    title: "Title",
    statusName: "Todo",
    statusType: "unstarted",
    project: "Mojito",
    labels: [],
    assignedToMe: true,
    ...p,
  };
}

function session(p: Partial<SessionMeta>): SessionMeta {
  return {
    kind: "ticket",
    id: "mojito-RIC-1-work",
    ticket: "RIC-1",
    launchStatus: "Todo",
    model: "opus",
    effort: "high",
    state: "running",
    cwd: "",
    createdAt: "2026-08-10T10:00:00.000Z",
    projectName: "Mojito",
    title: "Title",
    labels: [],
    ...p,
  } as SessionMeta;
}

const NO_FILTER = { query: "", project: [], status: null };

describe("buildUnifiedRows", () => {
  it("returns a row per ticket with no sessions attached when there are none", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })], sessions: [],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows).toHaveLength(1);
    expect(rows.ticketRows[0].sessions).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("nests a session under its own ticket", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" }), ticket({ identifier: "RIC-2" })],
      sessions: [session({ id: "a", ticket: "RIC-2" })],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions).toEqual([]);
    expect(rows.ticketRows[1].sessions.map((s) => s.id)).toEqual(["a"]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("orders a ticket's sessions newest first", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [
        session({ id: "old", createdAt: "2026-08-01T10:00:00.000Z" }),
        session({ id: "new", createdAt: "2026-08-09T10:00:00.000Z" }),
      ],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("treats a ticket-less session as loose", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "shell", kind: "shell", ticket: "", launchStatus: "" })],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["shell"]);
  });

  // The query narrows the loose set on the session's own fields, exactly as the old
  // session list did. A session that matches the search survives its ticket being hidden.
  it("keeps a session loose when the query hides its ticket but matches the session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", title: "Alpha", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", model: "fable" })],
      filter: { query: "fable", project: [], status: null }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  // The other side of the same rule, and the reason the query is not neutralised for
  // ticket-bearing sessions: if it were, searching for one ticket would drop every other
  // ticket's sessions into the "No ticket" group.
  it("drops a session when the query matches neither it nor its ticket", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", title: "Alpha" })],
      sessions: [session({ id: "a", ticket: "RIC-1" })],
      filter: { query: "zzz", project: [], status: null }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  // The ticket has moved on since its session launched, so a status chip can hide the
  // ticket while the session still matches. It must survive, under "No ticket".
  it("keeps a session loose when a status chip hides its ticket but not the session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "In Progress" })],
      filter: { query: "", project: [], status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("drops a session the status chip excludes on its own merits", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "Todo" })],
      filter: { query: "", project: [], status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  // The other half of the same rule: when the ticket IS visible, its sessions stay
  // nested regardless of whether their own fields would pass the filter — the status
  // chip only ever screens tickets and loose sessions, never a session already nested
  // under a visible ticket.
  it("keeps a session nested under its visible ticket even when the session's own status would fail the chip", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "In Progress" })],
      filter: { query: "", project: [], status: "Todo" }, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions.map((s) => s.id)).toEqual(["a"]);
    expect(rows.looseSessions).toEqual([]);
  });

  // Inverse pairing of the same rule, with the two statuses swapped, so the previous
  // test is not just an artefact of which literal happened to be "Todo".
  it("keeps a session nested under its visible ticket, statuses swapped from the case above", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "In Progress" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "Todo" })],
      filter: { query: "", project: [], status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows[0].sessions.map((s) => s.id)).toEqual(["a"]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("keeps a session loose when Mine has already scoped its ticket out", () => {
    // Mine is applied by the caller (mineOnly), so it reaches buildUnifiedRows as a
    // ticket that simply is not in the list.
    const rows = buildUnifiedRows({
      tickets: [],
      sessions: [session({ id: "a", ticket: "RIC-1" })],
      filter: NO_FILTER, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("filters loose sessions by project and query like the old session list did", () => {
    const sessions = [
      session({ id: "a", ticket: "", kind: "custom", projectName: "Mojito", title: "alpha" }),
      session({ id: "b", ticket: "", kind: "custom", projectName: "Other", title: "beta" }),
    ];
    expect(buildUnifiedRows({
      tickets: [], sessions, filter: { query: "", project: ["Other"], status: null }, sessionsOnly: false,
    }).looseSessions.map((s) => s.id)).toEqual(["b"]);
    expect(buildUnifiedRows({
      tickets: [], sessions, filter: { query: "alpha", project: [], status: null }, sessionsOnly: false,
    }).looseSessions.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("buildUnifiedRows with sessionsOnly", () => {
  it("drops tickets that have no session at all", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" }), ticket({ identifier: "RIC-2" })],
      sessions: [session({ id: "a", ticket: "RIC-2", state: "running" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-2"]);
  });

  // The reason the filter cannot key on the state: a work session that handed its stage
  // to QA sits at "done" with its tmux still up — it is the rework channel the gate
  // depends on, so a To QA ticket must stay visible under the Sessions filter.
  it("keeps a ticket whose only session is done", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "To QA" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "done" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-1"]);
  });

  it("keeps a ticket whose only session failed", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "failed" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-1"]);
  });

  it("keeps a ticket whose only session needs input", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "needs-input" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-1"]);
  });

  it("keeps loose sessions whatever their state", () => {
    const rows = buildUnifiedRows({
      tickets: [],
      sessions: [
        session({ id: "live", ticket: "", kind: "shell", state: "running", launchStatus: "" }),
        session({ id: "dead", ticket: "", kind: "shell", state: "failed", launchStatus: "" }),
      ],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["live", "dead"]);
  });

  it("still narrows loose sessions by the other criteria", () => {
    const rows = buildUnifiedRows({
      tickets: [],
      sessions: [
        session({ id: "here", ticket: "", kind: "shell", state: "done", launchStatus: "", projectName: "Mojito" }),
        session({ id: "elsewhere", ticket: "", kind: "shell", state: "done", launchStatus: "", projectName: "Other" }),
      ],
      filter: { query: "", project: ["Mojito"], status: null }, sessionsOnly: true,
    });
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["here"]);
  });
});

describe("orderTicketRows", () => {
  it("orders rows newest-identifier first, numeric-aware", () => {
    const rows = [
      { ticket: ticket({ identifier: "RIC-9" }), sessions: [] },
      { ticket: ticket({ identifier: "RIC-114" }), sessions: [] },
      { ticket: ticket({ identifier: "RIC-20" }), sessions: [] },
    ];
    expect(orderTicketRows(rows).map((r) => r.ticket.identifier))
      .toEqual(["RIC-114", "RIC-20", "RIC-9"]);
  });

  it("does not mutate the input", () => {
    const rows = [
      { ticket: ticket({ identifier: "RIC-1" }), sessions: [] },
      { ticket: ticket({ identifier: "RIC-2" }), sessions: [] },
    ];
    orderTicketRows(rows);
    expect(rows.map((r) => r.ticket.identifier)).toEqual(["RIC-1", "RIC-2"]);
  });
});

describe("mergedStatuses", () => {
  it("returns [] when there is nothing", () => {
    expect(mergedStatuses([], [])).toEqual([]);
  });

  it("unions ticket and session statuses without duplicates", () => {
    const statuses = mergedStatuses(
      [ticket({ statusName: "Todo" }), ticket({ statusName: "In Progress" })],
      [session({ launchStatus: "Todo" })],
    );
    expect(statuses).toEqual(["Todo", "In Progress"]);
  });

  it("ranks lifecycle statuses before the synthetic Custom and Terminal buckets", () => {
    const statuses = mergedStatuses(
      [ticket({ statusName: "To QA" }), ticket({ statusName: "Backlog" })],
      [
        session({ kind: "custom", ticket: "", launchStatus: "" }),
        session({ kind: "shell", ticket: "", launchStatus: "" }),
      ],
    );
    expect(statuses).toEqual(["Backlog", "To QA", "Custom", "Terminal"]);
  });

  it("drops empty statuses", () => {
    expect(mergedStatuses([ticket({ statusName: "" })], [])).toEqual([]);
  });
});

describe("mergedProjects", () => {
  it("unions ticket and session project names, sorted", () => {
    expect(mergedProjects(
      [ticket({ project: "Mojito" })],
      [session({ projectName: "Atlas" })],
    )).toEqual(["Atlas", "Mojito"]);
  });

  it("includes the no-project sentinel when either side lacks a project", () => {
    expect(mergedProjects([ticket({ project: null })], [])).toEqual(["No project"]);
    expect(mergedProjects([], [session({ projectName: null })])).toEqual(["No project"]);
  });

  it("does not duplicate a project both sides carry", () => {
    expect(mergedProjects(
      [ticket({ project: "Mojito" })],
      [session({ projectName: "Mojito" })],
    )).toEqual(["Mojito"]);
  });

  // RIC-225: the filter used to offer only the projects the board named, so a project
  // whose tickets were all closed could not be filtered to at all.
  it("offers a configured project with no ticket and no session of its own", () => {
    expect(mergedProjects([], [], ["Fornace", "Mojito"])).toEqual(["Fornace", "Mojito"]);
  });

  it("keeps a board project the configured list no longer has", () => {
    expect(mergedProjects([ticket({ project: "Retired" })], [], ["Mojito"]))
      .toEqual(["Mojito", "Retired"]);
  });

  it("does not duplicate a configured project the board also names", () => {
    expect(mergedProjects(
      [ticket({ project: "Mojito" })],
      [session({ projectName: "Mojito" })],
      ["Mojito"],
    )).toEqual(["Mojito"]);
  });

  it("keeps working with no configured list, so a failed fetch only narrows the options", () => {
    expect(mergedProjects([ticket({ project: "Mojito" })], [])).toEqual(["Mojito"]);
  });
});

describe("groupByProject", () => {
  function row(p: Partial<TicketSummary>): TicketRow {
    return { ticket: ticket(p), sessions: [] };
  }

  it("gives a project holding only loose sessions its own section", () => {
    const sections = groupByProject([], [session({ id: "a", projectName: "Atlas" })]);
    expect(sections).toEqual([
      { project: "Atlas", ticketRows: [], sessions: [session({ id: "a", projectName: "Atlas" })] },
    ]);
  });

  it("gives a project holding only ticket rows its own section", () => {
    const r = row({ identifier: "RIC-1", project: "Mojito" });
    const sections = groupByProject([r], []);
    expect(sections).toEqual([{ project: "Mojito", ticketRows: [r], sessions: [] }]);
  });

  it("carries both ticket rows and sessions in one section when a project has both", () => {
    const r = row({ identifier: "RIC-1", project: "Mojito" });
    const s = session({ id: "a", projectName: "Mojito" });
    const sections = groupByProject([r], [s]);
    expect(sections).toEqual([{ project: "Mojito", ticketRows: [r], sessions: [s] }]);
  });

  it("orders ticket-bearing projects before loose-only ones", () => {
    const r = row({ identifier: "RIC-1", project: "Mojito" });
    const s = session({ id: "a", projectName: "Atlas" });
    const sections = groupByProject([r], [s]);
    expect(sections.map((sec) => sec.project)).toEqual(["Mojito", "Atlas"]);
  });

  it("puts a null-project ticket and a null-project session in the same NO_PROJECT section", () => {
    const r = row({ identifier: "RIC-1", project: null });
    const s = session({ id: "a", projectName: null });
    const sections = groupByProject([r], [s]);
    expect(sections).toEqual([{ project: "No project", ticketRows: [r], sessions: [s] }]);
  });

  it("does not mutate its inputs", () => {
    const ticketRows = [row({ identifier: "RIC-1", project: "Mojito" })];
    const looseSessions = [session({ id: "a", projectName: "Atlas" })];
    groupByProject(ticketRows, looseSessions);
    expect(ticketRows).toHaveLength(1);
    expect(looseSessions).toHaveLength(1);
  });
});

describe("live ticket statuses", () => {
  // The RIC-218 case: the ticket moved to To QA, its session still says Todo. Under a
  // Todo status chip the ticket dropped out of `visible` while the session matched on
  // its stale launch status, so it surfaced alone in the "No ticket" group.
  it("does not orphan a session whose ticket moved past the filtered status", () => {
    const tickets = [ticket({ identifier: "RIC-218", statusName: "To QA" })];
    const sessions = [session({ id: "a", ticket: "RIC-218", launchStatus: "Todo" })];
    const rows = buildUnifiedRows({
      tickets, sessions, filter: { query: "", project: [], status: "Todo" },
      sessionsOnly: false, live: liveStatuses(tickets),
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions).toEqual([]);
  });

  it("keeps that session in the loose group under the ticket's current status", () => {
    const tickets = [ticket({ identifier: "RIC-218", statusName: "To QA", assignedToMe: false })];
    const sessions = [session({ id: "a", ticket: "RIC-218", launchStatus: "Todo" })];
    const rows = buildUnifiedRows({
      tickets: [], sessions, filter: { query: "", project: [], status: "To QA" },
      sessionsOnly: false, live: liveStatuses(tickets),
    });
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("derives the merged status chips from the ticket's current status", () => {
    const tickets = [ticket({ identifier: "RIC-218", statusName: "To QA" })];
    const sessions = [session({ ticket: "RIC-218", launchStatus: "Todo" })];
    expect(mergedStatuses(tickets, sessions, liveStatuses(tickets))).toEqual(["To QA"]);
  });
});
