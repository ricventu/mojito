import { describe, expect, it } from "vitest";
import type { TicketSummary } from "@mojito/shared";
import { setup } from "./setup";

const ticket: TicketSummary = {
  identifier: "RIC-1",
  title: "t",
  url: "https://linear.app/x/issue/RIC-1",
  statusName: "Todo",
  statusType: "unstarted",
  project: "Web",
  labels: [],
  assignedToMe: false,
};

describe("GET /api/tickets", () => {
  it("answers the cache snapshot", async () => {
    const { req, linear, tickets } = setup();
    linear.listOpenIssues.mockResolvedValue([ticket] as never);
    await tickets.refresh();
    const res = await req("/api/tickets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.tickets).toEqual([ticket]);
    expect(body.stale).toBe(false);
    expect(body.error).toBeNull();
  });
});

describe("GET /api/tickets/states", () => {
  it("answers the team's states", async () => {
    const { req, linear } = setup();
    const res = await req("/api/tickets/states?team=RIC");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["Backlog", "Todo", "In Progress"]);
    expect(linear.listTeamStates).toHaveBeenCalledWith("RIC");
  });

  it("refuses a request without a team", async () => {
    const { req, linear } = setup();
    const res = await req("/api/tickets/states");
    expect(res.status).toBe(400);
    expect(linear.listTeamStates).not.toHaveBeenCalled();
  });

  it("answers 502 when Linear fails", async () => {
    const { req, linear } = setup();
    linear.listTeamStates.mockRejectedValue(new Error("Linear API error: 503"));
    const res = await req("/api/tickets/states?team=RIC");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Linear API error: 503" });
  });
});

describe("POST /api/tickets/:id/status", () => {
  it("moves the ticket and refreshes the board", async () => {
    const { req, linear, refresh } = setup();
    const res = await req("/api/tickets/RIC-1/status", { method: "POST", json: { status: "Todo" } });
    expect(res.status).toBe(200);
    expect(linear.setStatus).toHaveBeenCalledWith("RIC-1", "Todo");
    expect(refresh).toHaveBeenCalled();
  });

  it("answers 502 with Linear's message on failure", async () => {
    const { req, linear, refresh } = setup();
    linear.setStatus.mockRejectedValue(new Error('workflow state "Nope" not found in team'));
    const res = await req("/api/tickets/RIC-1/status", { method: "POST", json: { status: "Nope" } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'workflow state "Nope" not found in team' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses an invalid ticket id before reaching Linear", async () => {
    const { req, linear } = setup();
    const res = await req("/api/tickets/ric-1/status", { method: "POST", json: { status: "Todo" } });
    expect(res.status).toBe(400);
    expect(linear.setStatus).not.toHaveBeenCalled();
  });

  it("refuses an empty status", async () => {
    const { req, linear } = setup();
    const res = await req("/api/tickets/RIC-1/status", { method: "POST", json: { status: "" } });
    expect(res.status).toBe(400);
    expect(linear.setStatus).not.toHaveBeenCalled();
  });
});
