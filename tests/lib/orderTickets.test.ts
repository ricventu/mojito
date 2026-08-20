import { describe, it, expect } from "vitest";
import { orderTickets } from "@/lib/orderTickets";
import type { TicketSummary } from "@/server/types";

function t(identifier: string): TicketSummary {
  return { identifier, title: "", url: "", statusName: "", statusType: "", project: null, labels: [], assignedToMe: true };
}

describe("orderTickets", () => {
  it("returns empty input unchanged", () => {
    expect(orderTickets([])).toEqual([]);
  });

  it("orders by identifier descending, numeric-aware", () => {
    const input = [t("RIC-9"), t("RIC-114"), t("RIC-20")];
    expect(orderTickets(input).map((x) => x.identifier)).toEqual(["RIC-114", "RIC-20", "RIC-9"]);
  });

  it("does not mutate the input array", () => {
    const input = [t("RIC-1"), t("RIC-2")];
    const copy = [...input];
    orderTickets(input);
    expect(input).toEqual(copy);
  });
});
