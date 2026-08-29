import { describe, expect, it } from "vitest";
import { NO_FILTERS, type AppLocation, type ListFilters } from "@/lib/appLocation";
import { filtersToRemember, seedFilters } from "@/lib/filterMemory";

const list = (filters: Partial<ListFilters> = {}): AppLocation => ({
  view: { kind: "list" },
  filters: { ...NO_FILTERS, ...filters },
});
const session = (filters: Partial<ListFilters> = {}): AppLocation => ({
  view: { kind: "session", id: "s1", docs: null },
  filters: { ...NO_FILTERS, ...filters },
});

describe("seedFilters", () => {
  it("restores the remembered filters when the board opens bare", () => {
    expect(seedFilters(list(), "project=Mojito&status=To+QA")).toEqual({
      ...NO_FILTERS, project: ["Mojito"], status: "To QA",
    });
  });

  // The whole point of keeping the url authoritative: a shared link, a bookmark or a
  // second tab's own state means exactly what it says, whatever storage remembers.
  it("leaves a url that carries filters alone", () => {
    expect(seedFilters(list({ status: "In Progress" }), "project=Mojito")).toBeNull();
  });

  // sessionUrl builds a terminal url deliberately clean of filters, and a docs
  // overlay is not the board either — neither is a place to restore a filter set.
  it("seeds nothing off the list", () => {
    expect(seedFilters(session(), "project=Mojito")).toBeNull();
  });

  it("seeds nothing when nothing was ever remembered", () => {
    expect(seedFilters(list(), null)).toBeNull();
  });

  // Clearing every filter is remembered as an empty search, and reopening the board
  // must not resurrect the selection the user just dropped.
  it("seeds nothing when the remembered set is empty", () => {
    expect(seedFilters(list(), "")).toBeNull();
  });

  it("seeds nothing when the remembered search holds only defaults", () => {
    expect(seedFilters(list(), "mine=0&q=")).toBeNull();
  });

  // RIC-275: Backlog hidden is the *default*, so a remembered set that only un-hides it
  // deviates from the default board without narrowing it — and has to be restored all
  // the same, or the preference is dropped on every launch.
  it("restores a remembered set whose only deviation is showing Backlog", () => {
    expect(seedFilters(list(), "backlog=1")).toEqual({ ...NO_FILTERS, backlog: true });
  });

  // Same rule on the other side: a url that already says backlog=1 is a url that names
  // filters, so storage must not correct it.
  it("leaves a url that only shows Backlog alone", () => {
    expect(seedFilters(list({ backlog: true }), "project=Mojito")).toBeNull();
  });

  it("ignores anything in the remembered search that is not a filter", () => {
    expect(seedFilters(list(), "doc=README.md&project=Mojito")).toEqual({
      ...NO_FILTERS, project: ["Mojito"],
    });
  });
});

describe("filtersToRemember", () => {
  it("remembers the board's filters as the search the address bar would carry", () => {
    expect(filtersToRemember(list({ project: ["Mojito"], mine: true })))
      .toBe("project=Mojito&mine=1");
  });

  it("remembers a cleared board as an empty search", () => {
    expect(filtersToRemember(list())).toBe("");
  });

  // Opening a session in a new browser tab lands on /session/<id> with no filters at
  // all; writing from there would wipe the remembered set on every such open.
  it("writes nothing from a view that is not the list", () => {
    expect(filtersToRemember(session({ project: ["Mojito"] }))).toBeNull();
  });
});
