import { describe, expect, it } from "vitest";
import { NO_FILTERS, type ListFilters } from "@/lib/appLocation";
import { backlogChip, cycleBacklog } from "@/lib/backlogFilter";

const filters = (p: Partial<ListFilters> = {}): ListFilters => ({ ...NO_FILTERS, ...p });

describe("backlogChip", () => {
  it("reads the default board as off — Backlog is hidden until asked for", () => {
    expect(backlogChip(NO_FILTERS)).toBe("off");
  });

  it("reads an explicit Backlog selection as only", () => {
    expect(backlogChip(filters({ status: "Backlog" }))).toBe("only");
  });

  it("reads the un-hidden board as on", () => {
    expect(backlogChip(filters({ backlog: true }))).toBe("on");
  });

  // The exclusion is moot while another status is selected — that filter already drops
  // every Backlog ticket — but the chip still reports what happens on the way back to
  // All, which is the only place its state is visible.
  it("still reports off while another status is selected", () => {
    expect(backlogChip(filters({ status: "Todo" }))).toBe("off");
  });

  it("lets an explicit Backlog selection win over the flag", () => {
    expect(backlogChip(filters({ status: "Backlog", backlog: true }))).toBe("only");
  });
});

describe("cycleBacklog", () => {
  it("goes off → only", () => {
    expect(cycleBacklog(NO_FILTERS)).toEqual(filters({ status: "Backlog" }));
  });

  it("goes only → on, dropping the selection so every status shows", () => {
    expect(cycleBacklog(filters({ status: "Backlog" }))).toEqual(filters({ backlog: true }));
  });

  it("goes on → off", () => {
    expect(cycleBacklog(filters({ backlog: true }))).toEqual(NO_FILTERS);
  });

  it("returns to where it started after three taps", () => {
    const start = filters({ project: ["Mojito"], mine: true });
    expect(cycleBacklog(cycleBacklog(cycleBacklog(start)))).toEqual(start);
  });

  // Only the two values the chip owns move; a project selection or Mine is none of its
  // business, and rebuilding the whole set would silently clear them.
  it("leaves the other filters alone", () => {
    const start = filters({ query: "alpha", project: ["Mojito"], mine: true, sessionsOnly: true });
    expect(cycleBacklog(start)).toEqual({ ...start, status: "Backlog" });
  });

  // Off is reached from any status, so the last tap must not also drop a selection the
  // user made two rows up — tapping a status chip is what changes a status.
  it("keeps another status when un-hiding is undone", () => {
    const start = filters({ status: "Todo", backlog: true });
    expect(cycleBacklog(start)).toEqual(filters({ status: "Todo" }));
  });

  it("returns a fresh object rather than mutating the input", () => {
    const start = filters({ project: ["Mojito"] });
    const next = cycleBacklog(start);
    expect(next).not.toBe(start);
    expect(start).toEqual(filters({ project: ["Mojito"] }));
  });
});
