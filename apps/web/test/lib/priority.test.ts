import { describe, expect, it } from "vitest";
import type { TicketSummary } from "@mojito/shared";
import { priorityInfo, priorityRank, settledPick, ticketPriority } from "@/lib/priority";

const t = (priority?: unknown) =>
  ({ identifier: "RIC-1", ...(priority === undefined ? {} : { priority }) }) as unknown as TicketSummary;

describe("ticketPriority", () => {
  it("is the ticket's 0-4 priority, else 0 (an older peer sends none)", () => {
    expect([t(1), t(4), t(0), t(), t(7), t(2.5), t("1")].map(ticketPriority)).toEqual([1, 4, 0, 0, 0, 0, 0]);
  });
});

describe("priorityRank", () => {
  it("puts Urgent first and No priority last", () => {
    expect([1, 2, 3, 4, 0].map(priorityRank)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("priorityInfo", () => {
  it("names each value and its url key", () => {
    expect(priorityInfo(1)).toEqual({ value: 1, key: "urgent", name: "Urgent" });
    expect(priorityInfo(0)).toEqual({ value: 0, key: "none", name: "No priority" });
  });
});

describe("settledPick", () => {
  it("keeps a priority picked in the sheet until the ticket agrees, then lets the ticket speak", () => {
    expect(settledPick(2, 0, true)).toBe(2); // write in flight
    expect(settledPick(2, 0, false)).toBe(2); // refetch not in yet
    expect(settledPick(2, 2, false)).toBeNull(); // caught up: a later change elsewhere shows
    expect(settledPick(null, 3, false)).toBeNull();
  });
});
