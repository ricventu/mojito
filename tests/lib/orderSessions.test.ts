import { describe, it, expect } from "vitest";
import { orderSessions } from "@/lib/orderSessions";
import type { SessionMeta } from "@/server/types";

// minimal SessionMeta factory — only the fields orderSessions reads matter
function s(id: string, ticket: string, createdAt: string): SessionMeta {
  return {
    kind: "lime", id, ticket, createdAt,
    launchStatus: "", model: "", effort: "low", autoAdvance: false,
    state: "running", cwd: "", title: "", labels: [],
  } as SessionMeta;
}

describe("orderSessions", () => {
  it("returns empty and single-element inputs unchanged", () => {
    expect(orderSessions([])).toEqual([]);
    const one = [s("a", "RIC-1", "2026-07-14T10:00:00.000Z")];
    expect(orderSessions(one).map((x) => x.id)).toEqual(["a"]);
  });

  it("clusters sessions of the same ticket adjacently", () => {
    const input = [
      s("a", "RIC-1", "2026-07-14T10:00:00.000Z"),
      s("b", "RIC-2", "2026-07-14T11:00:00.000Z"),
      s("c", "RIC-1", "2026-07-14T09:00:00.000Z"),
    ];
    const tickets = orderSessions(input).map((x) => x.ticket);
    // RIC-1 sessions must be contiguous, RIC-2 sessions contiguous
    expect(tickets).toEqual(["RIC-2", "RIC-1", "RIC-1"]);
  });

  it("orders sessions newest-first within a cluster", () => {
    const input = [
      s("old", "RIC-1", "2026-07-14T09:00:00.000Z"),
      s("new", "RIC-1", "2026-07-14T12:00:00.000Z"),
      s("mid", "RIC-1", "2026-07-14T10:00:00.000Z"),
    ];
    expect(orderSessions(input).map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  it("orders clusters by their newest session, newest-first", () => {
    const input = [
      s("a1", "RIC-1", "2026-07-14T09:00:00.000Z"),
      s("a2", "RIC-1", "2026-07-14T10:00:00.000Z"), // RIC-1 newest = 10:00
      s("b1", "RIC-2", "2026-07-14T12:00:00.000Z"), // RIC-2 newest = 12:00
    ];
    expect(orderSessions(input).map((x) => x.ticket)).toEqual(["RIC-2", "RIC-1", "RIC-1"]);
  });

  it("tie-breaks equal createdAt by id, descending, deterministically", () => {
    const t = "2026-07-14T10:00:00.000Z";
    const input = [
      s("a", "RIC-1", t),
      s("c", "RIC-1", t),
      s("b", "RIC-1", t),
    ];
    expect(orderSessions(input).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate its input", () => {
    const input = [
      s("a", "RIC-1", "2026-07-14T09:00:00.000Z"),
      s("b", "RIC-1", "2026-07-14T12:00:00.000Z"),
    ];
    const before = input.map((x) => x.id);
    orderSessions(input);
    expect(input.map((x) => x.id)).toEqual(before);
  });
});
