import { describe, it, expect } from "vitest";
import { buildUnifiedRows, orderTicketRows } from "@/lib/unifiedRows";
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

const NO_FILTER = { query: "", project: null, status: null };

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

  // The invariant: a session whose ticket is filtered away is never lost, it goes loose.
  it("keeps a session loose when the query hides its ticket", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", title: "Alpha" })],
      sessions: [session({ id: "a", ticket: "RIC-1" })],
      filter: { query: "zzz", project: null, status: null }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  // The ticket has moved on since its session launched, so a status chip can hide the
  // ticket while the session still matches. It must survive, under "No ticket".
  it("keeps a session loose when a status chip hides its ticket but not the session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "In Progress" })],
      filter: { query: "", project: null, status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("drops a session the status chip excludes on its own merits", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1", statusName: "Todo" })],
      sessions: [session({ id: "a", ticket: "RIC-1", launchStatus: "Todo" })],
      filter: { query: "", project: null, status: "In Progress" }, sessionsOnly: false,
    });
    expect(rows.ticketRows).toEqual([]);
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
      tickets: [], sessions, filter: { query: "", project: "Other", status: null }, sessionsOnly: false,
    }).looseSessions.map((s) => s.id)).toEqual(["b"]);
    expect(buildUnifiedRows({
      tickets: [], sessions, filter: { query: "alpha", project: null, status: null }, sessionsOnly: false,
    }).looseSessions.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("buildUnifiedRows with sessionsOnly", () => {
  it("drops tickets that have no active session", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" }), ticket({ identifier: "RIC-2" })],
      sessions: [session({ id: "a", ticket: "RIC-2", state: "running" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-2"]);
  });

  it("drops a ticket whose only session is finished", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "done" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows).toEqual([]);
  });

  it("keeps a ticket whose only session needs input", () => {
    const rows = buildUnifiedRows({
      tickets: [ticket({ identifier: "RIC-1" })],
      sessions: [session({ id: "a", ticket: "RIC-1", state: "needs-input" })],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.ticketRows.map((r) => r.ticket.identifier)).toEqual(["RIC-1"]);
  });

  it("keeps only active loose sessions", () => {
    const rows = buildUnifiedRows({
      tickets: [],
      sessions: [
        session({ id: "live", ticket: "", kind: "shell", state: "running", launchStatus: "" }),
        session({ id: "dead", ticket: "", kind: "shell", state: "failed", launchStatus: "" }),
      ],
      filter: NO_FILTER, sessionsOnly: true,
    });
    expect(rows.looseSessions.map((s) => s.id)).toEqual(["live"]);
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
