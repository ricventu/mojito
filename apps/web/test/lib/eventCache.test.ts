import { describe, expect, it } from "vitest";
import { removeById, upsertById } from "@/lib/eventCache";

type Row = { id: string; v: number };

describe("upsertById", () => {
  it("appends an unknown row", () => {
    expect(upsertById<Row>([{ id: "a", v: 1 }], { id: "b", v: 2 })).toEqual([{ id: "a", v: 1 }, { id: "b", v: 2 }]);
  });
  it("replaces a known row in place", () => {
    expect(upsertById<Row>([{ id: "a", v: 1 }, { id: "b", v: 2 }], { id: "a", v: 9 })).toEqual([{ id: "a", v: 9 }, { id: "b", v: 2 }]);
  });
  it("starts a list from nothing", () => {
    expect(upsertById<Row>(undefined, { id: "a", v: 1 })).toEqual([{ id: "a", v: 1 }]);
  });
});

describe("removeById", () => {
  it("drops the row", () => {
    expect(removeById<Row>([{ id: "a", v: 1 }, { id: "b", v: 2 }], "a")).toEqual([{ id: "b", v: 2 }]);
  });
  it("tolerates an empty cache", () => {
    expect(removeById<Row>(undefined, "a")).toEqual([]);
  });
});
