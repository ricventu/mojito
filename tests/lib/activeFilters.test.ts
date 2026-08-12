import { describe, it, expect } from "vitest";
import { activeFilters, type FilterState } from "@/lib/activeFilters";

// Every filter off — the landing state once Mine defaults off (Task 3). Each test
// overrides only the filter it is about.
function state(p: Partial<FilterState> = {}): FilterState {
  return { query: "", project: null, status: null, mine: false, sessionsOnly: false, ...p };
}

describe("activeFilters", () => {
  it("returns [] when nothing narrows the list", () => {
    expect(activeFilters(state())).toEqual([]);
  });

  it("reports a query under its trimmed text", () => {
    expect(activeFilters(state({ query: "  182 " }))).toEqual([{ key: "query", label: "182" }]);
  });

  it("treats a whitespace-only query as absent, as filterTickets does", () => {
    expect(activeFilters(state({ query: "   " }))).toEqual([]);
  });

  it("reports a project under its own name", () => {
    expect(activeFilters(state({ project: "Mojito" })))
      .toEqual([{ key: "project", label: "Mojito" }]);
  });

  it("labels the No project sentinel as-is, since it is the chip's own value", () => {
    expect(activeFilters(state({ project: "No project" })))
      .toEqual([{ key: "project", label: "No project" }]);
  });

  it("reports a status under its own name", () => {
    expect(activeFilters(state({ status: "To QA" })))
      .toEqual([{ key: "status", label: "To QA" }]);
  });

  it("labels the Mine toggle", () => {
    expect(activeFilters(state({ mine: true }))).toEqual([{ key: "mine", label: "Mine" }]);
  });

  it("labels the Sessions toggle", () => {
    expect(activeFilters(state({ sessionsOnly: true })))
      .toEqual([{ key: "sessions", label: "Sessions" }]);
  });

  it("counts an empty-string project or status as set, since only null is unset", () => {
    expect(activeFilters(state({ project: "", status: "" }))).toEqual([
      { key: "project", label: "" },
      { key: "status", label: "" },
    ]);
  });

  it("orders every filter query-first, so the one that scrolls away leads", () => {
    const all = state({
      query: "182", project: "Mojito", status: "To QA", mine: true, sessionsOnly: true,
    });
    expect(activeFilters(all).map((f) => f.key))
      .toEqual(["query", "project", "status", "mine", "sessions"]);
  });
});
