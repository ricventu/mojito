import { describe, it, expect } from "vitest";
import { activeFilters, removeFilter } from "@/lib/activeFilters";
import type { ListFilters } from "@/lib/appLocation";

// Every filter off — the landing state once Mine defaults off (Task 3). Each test
// overrides only the filter it is about.
function state(p: Partial<ListFilters> = {}): ListFilters {
  return { query: "", project: [], status: null, mine: false, sessionsOnly: false, backlog: false, ...p };
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

  it("reports a project under its own name, carrying it as the chip's value", () => {
    expect(activeFilters(state({ project: ["Mojito"] })))
      .toEqual([{ key: "project", label: "Mojito", value: "Mojito" }]);
  });

  it("labels the No project sentinel as-is, since it is the filter's own value", () => {
    expect(activeFilters(state({ project: ["No project"] })))
      .toEqual([{ key: "project", label: "No project", value: "No project" }]);
  });

  it("reports one chip per selected project, in selection order (RIC-252)", () => {
    expect(activeFilters(state({ project: ["Mojito", "Fornace"] })))
      .toEqual([
        { key: "project", label: "Mojito", value: "Mojito" },
        { key: "project", label: "Fornace", value: "Fornace" },
      ]);
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

  it("counts an empty-string project or status as set, since only [] and null are unset", () => {
    expect(activeFilters(state({ project: [""], status: "" }))).toEqual([
      { key: "project", label: "", value: "" },
      { key: "status", label: "" },
    ]);
  });

  it("orders every filter query-first, so the one that scrolls away leads", () => {
    const all = state({
      query: "182", project: ["Mojito"], status: "To QA", mine: true, sessionsOnly: true,
    });
    expect(activeFilters(all).map((f) => f.key))
      .toEqual(["query", "project", "status", "mine", "sessions"]);
  });

  it("keeps the project chips together, one per name, ahead of status", () => {
    const all = state({ query: "182", project: ["Mojito", "Fornace"], status: "To QA" });
    expect(activeFilters(all).map((f) => f.key))
      .toEqual(["query", "project", "project", "status"]);
  });

  // RIC-275. Showing the Backlog deviates from the default board but narrows nothing,
  // and this bar reports only what hides things — a badge here would be permanent for
  // anyone who prefers that bucket visible. The chip one row up is where its state
  // lives.
  it("reports nothing for the Backlog filter, in either state", () => {
    expect(activeFilters(state({ backlog: true }))).toEqual([]);
    expect(activeFilters(state({ backlog: false }))).toEqual([]);
  });
});

describe("removeFilter", () => {
  const all = (): ListFilters => ({
    query: "182",
    project: ["Mojito", "Fornace", "Viessmann"],
    status: "To QA",
    mine: true,
    sessionsOnly: true,
    backlog: true,
  });

  it("drops only the project its chip names, leaving the rest selected (RIC-252)", () => {
    expect(removeFilter(all(), { key: "project", label: "Fornace", value: "Fornace" }))
      .toEqual({ ...all(), project: ["Mojito", "Viessmann"] });
  });

  it("drops the No project sentinel like any other name", () => {
    const filters: ListFilters = { ...all(), project: ["No project", "Mojito"] };
    expect(removeFilter(filters, { key: "project", label: "No project", value: "No project" }))
      .toEqual({ ...filters, project: ["Mojito"] });
  });

  it("clears the whole project selection for a chip with no value", () => {
    expect(removeFilter(all(), { key: "project", label: "Mojito, Fornace" }))
      .toEqual({ ...all(), project: [] });
  });

  it("leaves the selection alone when the named project is not in it", () => {
    expect(removeFilter(all(), { key: "project", label: "Gone", value: "Gone" }))
      .toEqual(all());
  });

  it("clears the query", () => {
    expect(removeFilter(all(), { key: "query", label: "182" }))
      .toEqual({ ...all(), query: "" });
  });

  it("clears the status back to null, not to the empty string", () => {
    expect(removeFilter(all(), { key: "status", label: "To QA" }))
      .toEqual({ ...all(), status: null });
  });

  it("turns the Mine and Sessions toggles off", () => {
    expect(removeFilter(all(), { key: "mine", label: "Mine" }))
      .toEqual({ ...all(), mine: false });
    expect(removeFilter(all(), { key: "sessions", label: "Sessions" }))
      .toEqual({ ...all(), sessionsOnly: false });
  });

  it("never mutates the filters it is given", () => {
    const filters = all();
    removeFilter(filters, { key: "project", label: "Mojito", value: "Mojito" });
    expect(filters).toEqual(all());
  });

  // The bar clears everything it reports — and only that. Backlog is not among the
  // chips (RIC-275), so emptying the bar leaves it where it was; restoring the default
  // board is "Clear all", which writes NO_FILTERS wholesale rather than walking chips.
  it("removes every chip it reports, one after another, back to the clean board", () => {
    let filters = all();
    for (const chip of activeFilters(filters)) filters = removeFilter(filters, chip);
    expect(filters).toEqual({
      query: "", project: [], status: null, mine: false, sessionsOnly: false, backlog: true,
    });
  });
});
