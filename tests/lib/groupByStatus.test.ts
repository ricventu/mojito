import { describe, it, expect } from "vitest";
import { groupByStatus } from "@/lib/groupByStatus";

type Item = { id: string; status: string };
const get = (i: Item) => i.status;

describe("groupByStatus", () => {
  it("returns [] for empty input", () => {
    expect(groupByStatus([] as Item[], get)).toEqual([]);
  });

  it("orders groups by lifecycle rank", () => {
    const items: Item[] = [
      { id: "a", status: "Done" },
      { id: "b", status: "In Progress" },
      { id: "c", status: "Backlog" },
    ];
    expect(groupByStatus(items, get).map((g) => g.status)).toEqual([
      "Backlog", "In Progress", "Done",
    ]);
  });

  it("sorts unknown statuses last, alphabetically among themselves", () => {
    const items: Item[] = [
      { id: "a", status: "Zeta" },
      { id: "b", status: "Alpha" },
      { id: "c", status: "In Progress" },
    ];
    expect(groupByStatus(items, get).map((g) => g.status)).toEqual([
      "In Progress", "Alpha", "Zeta",
    ]);
  });

  it("preserves input order of items within a group", () => {
    const items: Item[] = [
      { id: "a", status: "In Progress" },
      { id: "b", status: "In Progress" },
      { id: "c", status: "In Progress" },
    ];
    expect(groupByStatus(items, get)[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const items: Item[] = [
      { id: "a", status: "Done" },
      { id: "b", status: "Backlog" },
    ];
    const copy = [...items];
    groupByStatus(items, get);
    expect(items).toEqual(copy);
  });
});
