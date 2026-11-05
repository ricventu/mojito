import { describe, expect, it } from "vitest";
import {
  FILTER_STATUSES,
  NO_FILTERS,
  canonicalSearch,
  filterCount,
  filterSearch,
  isFiltered,
  parseFilters,
  sheetProjects,
} from "@/lib/filters";

describe("FILTER_STATUSES", () => {
  it("follows the workflow, from Backlog to In Review", () => {
    expect(FILTER_STATUSES).toEqual(["Backlog", "Todo", "In Progress", "In Review"]);
  });
});

describe("parseFilters", () => {
  it("parses repeated project and status", () => {
    expect(parseFilters(new URLSearchParams("project=b&project=a&status=Todo&q=x"))).toEqual({
      projects: ["a", "b"],
      statuses: ["Todo"],
      live: false,
      q: "x",
    });
  });

  it("drops unknown parameters and statuses", () => {
    expect(parseFilters(new URLSearchParams("doc=1&status=Done&status=Todo"))).toEqual({
      projects: [],
      statuses: ["Todo"],
      live: false,
      q: "",
    });
  });

  it("drops empty and duplicate projects and orders statuses canonically", () => {
    expect(
      parseFilters(new URLSearchParams("project=&project=a&project=a&status=Backlog&status=In+Review&status=Backlog")),
    ).toEqual({ projects: ["a"], statuses: ["Backlog", "In Review"], live: false, q: "" });
  });

  it("orders projects by code unit, never by the device's locale", () => {
    // Favourites are compared as strings across devices: the order must not depend on ICU.
    expect(parseFilters(new URLSearchParams("project=b&project=%C3%A4&project=a&project=B")).projects).toEqual([
      "B",
      "a",
      "b",
      "ä",
    ]);
  });

  it("reads the active-sessions filter from live=1 only", () => {
    expect(parseFilters(new URLSearchParams("live=1")).live).toBe(true);
    expect(parseFilters(new URLSearchParams("live=0")).live).toBe(false);
    expect(parseFilters(new URLSearchParams("")).live).toBe(false);
  });

  it("keeps q's spaces in the live url", () => {
    expect(parseFilters(new URLSearchParams(filterSearch({ ...NO_FILTERS, q: "foo " }))).q).toBe("foo ");
  });

  it("round-trips awkward project names", () => {
    const f = { projects: ["R&D", "a=b", "c+d", "Città nuova"], statuses: [], live: false, q: "" };
    const parsed = parseFilters(new URLSearchParams(filterSearch(f)));
    expect(parsed.projects).toEqual([...f.projects].sort());
    expect(parseFilters(new URLSearchParams(filterSearch(parsed)))).toEqual(parsed);
  });
});

describe("filterSearch", () => {
  it("writes the canonical order", () => {
    expect(filterSearch({ projects: ["b", "a", "a"], statuses: ["In Review", "Backlog"], live: true, q: "x" })).toBe(
      "project=a&project=b&status=Backlog&status=In+Review&live=1&q=x",
    );
  });

  it("writes projects in code-unit order", () => {
    expect(filterSearch({ projects: ["b", "a", "B"], statuses: [], live: false, q: "" })).toBe("project=B&project=a&project=b");
  });

  it("omits defaults", () => {
    expect(filterSearch(NO_FILTERS)).toBe("");
    expect(filterSearch({ ...NO_FILTERS, q: "   " })).toBe("");
  });
});

describe("canonicalSearch", () => {
  it("trims q", () => {
    expect(canonicalSearch({ ...NO_FILTERS, q: " foo " })).toBe(canonicalSearch({ ...NO_FILTERS, q: "foo" }));
    expect(canonicalSearch({ ...NO_FILTERS, q: " foo " })).toBe("q=foo");
  });
});

describe("isFiltered", () => {
  it("is false for no filters and a blank q", () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: "  " })).toBe(false);
  });

  it("is true for each axis alone", () => {
    expect(isFiltered({ ...NO_FILTERS, projects: ["a"] })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, statuses: ["Todo"] })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, live: true })).toBe(true);
    expect(isFiltered({ ...NO_FILTERS, q: "x" })).toBe(true);
  });
});

describe("filterCount", () => {
  it("counts projects, statuses and active sessions, not q", () => {
    expect(filterCount({ projects: ["a", "b"], statuses: ["Todo"], live: false, q: "x" })).toBe(3);
    expect(filterCount({ projects: ["a", "b"], statuses: ["Todo"], live: true, q: "x" })).toBe(4);
  });
});

describe("sheetProjects", () => {
  it("keeps selected unknown projects", () => {
    expect(sheetProjects(["b", "a"], ["z", "a"])).toEqual(["a", "b", "z"]);
  });
});
