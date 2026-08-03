import { describe, it, expect } from "vitest";
import { NO_PROJECT, ticketStatuses, filterTickets, mineOnly, showsMineMarker } from "@/lib/ticketFilter";
import type { TicketSummary } from "@/server/types";

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

describe("NO_PROJECT", () => {
  it("is the shared no-project sentinel", () => {
    expect(NO_PROJECT).toBe("No project");
  });
});

describe("ticketStatuses", () => {
  it("returns [] for no tickets", () => {
    expect(ticketStatuses([])).toEqual([]);
  });

  it("returns distinct statuses ordered by lifecycle rank", () => {
    const tickets = [
      ticket({ statusName: "Done" }),
      ticket({ statusName: "To Code" }),
      ticket({ statusName: "Todo" }),
      ticket({ statusName: "To Code" }),
    ];
    expect(ticketStatuses(tickets)).toEqual(["Todo", "To Code", "Done"]);
  });

  it("sorts unknown statuses last, alphabetically among themselves", () => {
    const tickets = [
      ticket({ statusName: "Zeta" }),
      ticket({ statusName: "Alpha" }),
      ticket({ statusName: "To Code" }),
    ];
    expect(ticketStatuses(tickets)).toEqual(["To Code", "Alpha", "Zeta"]);
  });
});

describe("mineOnly", () => {
  const tickets = [
    ticket({ identifier: "RIC-1", assignedToMe: true }),
    ticket({ identifier: "RIC-2", assignedToMe: false }),
    ticket({ identifier: "RIC-3", assignedToMe: true }),
  ];

  it("keeps only the viewer's tickets when the filter is on", () => {
    expect(mineOnly(tickets, true).map((t) => t.identifier)).toEqual(["RIC-1", "RIC-3"]);
  });

  it("returns every ticket when the filter is off", () => {
    expect(mineOnly(tickets, false).map((t) => t.identifier)).toEqual(["RIC-1", "RIC-2", "RIC-3"]);
  });

  it("scopes the derived status chips, so no chip yields an empty list", () => {
    const mixed = [
      ticket({ statusName: "Todo", assignedToMe: true }),
      ticket({ statusName: "To Code", assignedToMe: false }),
    ];
    expect(ticketStatuses(mineOnly(mixed, true))).toEqual(["Todo"]);
    expect(ticketStatuses(mineOnly(mixed, false))).toEqual(["Todo", "To Code"]);
  });
});

describe("showsMineMarker", () => {
  const ours = ticket({ assignedToMe: true });
  const theirs = ticket({ assignedToMe: false });

  it("marks the viewer's tickets while the filter is off", () => {
    expect(showsMineMarker(ours, false)).toBe(true);
    expect(showsMineMarker(theirs, false)).toBe(false);
  });

  it("marks nothing while the filter is on, where every ticket is the viewer's", () => {
    expect(showsMineMarker(ours, true)).toBe(false);
    expect(showsMineMarker(theirs, true)).toBe(false);
  });
});

describe("filterTickets", () => {
  const tickets = [
    ticket({ identifier: "RIC-1", title: "Alpha", statusName: "Todo", project: "Mojito", labels: ["Bug"] }),
    ticket({ identifier: "RIC-2", title: "Beta", statusName: "To Code", project: "Lime", labels: [] }),
    ticket({ identifier: "RIC-3", title: "Gamma", statusName: "Todo", project: null, labels: ["Feature"] }),
  ];

  it("returns all tickets when no filter is active", () => {
    expect(filterTickets(tickets, { query: "", project: null, status: null })).toHaveLength(3);
  });

  it("filters by project", () => {
    const out = filterTickets(tickets, { query: "", project: "Lime", status: null });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-2"]);
  });

  it("matches null-project tickets via the NO_PROJECT sentinel", () => {
    const out = filterTickets(tickets, { query: "", project: NO_PROJECT, status: null });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-3"]);
  });

  it("filters by status", () => {
    const out = filterTickets(tickets, { query: "", project: null, status: "Todo" });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-1", "RIC-3"]);
  });

  it("filters by query across identifier, title, status, and labels", () => {
    expect(filterTickets(tickets, { query: "ric-2", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(filterTickets(tickets, { query: "beta", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(filterTickets(tickets, { query: "to code", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-2"]);
    expect(filterTickets(tickets, { query: "feature", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-3"]);
  });

  it("trims and lowercases the query", () => {
    expect(filterTickets(tickets, { query: "  ALPHA  ", project: null, status: null }).map((t) => t.identifier)).toEqual(["RIC-1"]);
  });

  it("combines project AND status AND query", () => {
    const out = filterTickets(tickets, { query: "gamma", project: NO_PROJECT, status: "Todo" });
    expect(out.map((t) => t.identifier)).toEqual(["RIC-3"]);
    expect(filterTickets(tickets, { query: "gamma", project: "Mojito", status: "Todo" })).toEqual([]);
  });
});
