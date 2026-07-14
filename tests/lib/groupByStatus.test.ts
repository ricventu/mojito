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
      { id: "b", status: "To Code" },
      { id: "c", status: "Backlog" },
    ];
    expect(groupByStatus(items, get).map((g) => g.status)).toEqual([
      "Backlog", "To Code", "Done",
    ]);
  });

  it("sorts unknown statuses last, alphabetically among themselves", () => {
    const items: Item[] = [
      { id: "a", status: "Zeta" },
      { id: "b", status: "Alpha" },
      { id: "c", status: "To Code" },
    ];
    expect(groupByStatus(items, get).map((g) => g.status)).toEqual([
      "To Code", "Alpha", "Zeta",
    ]);
  });

  it("preserves input order of items within a group", () => {
    const items: Item[] = [
      { id: "a", status: "To Code" },
      { id: "b", status: "To Code" },
      { id: "c", status: "To Code" },
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
