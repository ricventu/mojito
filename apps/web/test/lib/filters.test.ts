import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  canonicalSearch,
  filterCount,
  filterSearch,
  isFiltered,
  parseFilters,
  sheetProjects,
} from "@/lib/filters";

describe("parseFilters", () => {
  it("parses repeated project and status", () => {
    expect(parseFilters(new URLSearchParams("project=b&project=a&status=Todo&q=x"))).toEqual({
      projects: ["a", "b"],
      statuses: ["Todo"],
      q: "x",
    });
  });

  it("drops unknown parameters and statuses", () => {
    expect(parseFilters(new URLSearchParams("doc=1&status=Done&status=Todo"))).toEqual({
      projects: [],
      statuses: ["Todo"],
      q: "",
    });
  });

  it("drops empty and duplicate projects and orders statuses canonically", () => {
    expect(
      parseFilters(new URLSearchParams("project=&project=a&project=a&status=Backlog&status=In+Review&status=Backlog")),
    ).toEqual({ projects: ["a"], statuses: ["In Review", "Backlog"], q: "" });
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

  it("keeps q's spaces in the live url", () => {
    expect(parseFilters(new URLSearchParams(filterSearch({ ...NO_FILTERS, q: "foo " }))).q).toBe("foo ");
  });

  it("round-trips awkward project names", () => {
    const f = { projects: ["R&D", "a=b", "c+d", "Città nuova"], statuses: [], q: "" };
    const parsed = parseFilters(new URLSearchParams(filterSearch(f)));
    expect(parsed.projects).toEqual([...f.projects].sort());
    expect(parseFilters(new URLSearchParams(filterSearch(parsed)))).toEqual(parsed);
  });
});

describe("filterSearch", () => {
  it("writes the canonical order", () => {
    expect(filterSearch({ projects: ["b", "a", "a"], statuses: ["Backlog", "In Review"], q: "x" })).toBe(
      "project=a&project=b&status=In+Review&status=Backlog&q=x",
    );
  });

  it("writes projects in code-unit order", () => {
    expect(filterSearch({ projects: ["b", "a", "B"], statuses: [], q: "" })).toBe("project=B&project=a&project=b");
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
    expect(isFiltered({ ...NO_FILTERS, q: "x" })).toBe(true);
  });
});

describe("filterCount", () => {
  it("counts projects and statuses, not q", () => {
    expect(filterCount({ projects: ["a", "b"], statuses: ["Todo"], q: "x" })).toBe(3);
  });
});

describe("sheetProjects", () => {
  it("keeps selected unknown projects", () => {
    expect(sheetProjects(["b", "a"], ["z", "a"])).toEqual(["a", "b", "z"]);
  });
});
