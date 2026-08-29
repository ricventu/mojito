import { describe, it, expect } from "vitest";
import { KNOWN_STATUSES, MANUAL_STATUSES } from "@/server/statusModel";
import { STATUS_ORDER, STATUS_COLOR, statusRank, statusColorClass, manualMoveTarget, CUSTOM_STATUS, INTAKE_STATUS, TERMINAL_STATUS } from "@/lib/status";

describe("status metadata", () => {
  it("covers exactly the statuses the server model knows — nothing missing, nothing extra", () => {
    const known = new Set(KNOWN_STATUSES);
    expect(new Set(Object.keys(STATUS_ORDER))).toEqual(known);
    expect(new Set(Object.keys(STATUS_COLOR))).toEqual(known);
  });

  it("assigns a unique rank to each status", () => {
    const ranks = Object.values(STATUS_ORDER);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("orders the lifecycle Backlog → Duplicate", () => {
    expect(statusRank("Backlog")).toBeLessThan(statusRank("In Progress"));
    expect(statusRank("In Progress")).toBeLessThan(statusRank("Done"));
    expect(statusRank("Done")).toBeLessThan(statusRank("Duplicate"));
  });

  it("sorts unknown statuses last and colors them muted", () => {
    expect(statusRank("Whatever")).toBe(Number.MAX_SAFE_INTEGER);
    expect(statusRank("Whatever")).toBeGreaterThan(statusRank("Duplicate"));
    expect(statusColorClass("Whatever")).toBe("muted");
  });

  it("returns the mapped color for a known status", () => {
    expect(statusColorClass("In Progress")).toBe("blue");
    expect(statusColorClass("Done")).toBe("green");
  });

  it("gives the custom, intake and terminal buckets their own distinct hues", () => {
    expect(statusColorClass(CUSTOM_STATUS)).toBe("pink");
    expect(statusColorClass(INTAKE_STATUS)).toBe("indigo");
    expect(statusColorClass(TERMINAL_STATUS)).toBe("term");
    const hues = [CUSTOM_STATUS, INTAKE_STATUS, TERMINAL_STATUS].map(statusColorClass);
    expect(new Set(hues).size).toBe(hues.length);
  });

  // The synthetic buckets share the badge stylesheet with the lifecycle statuses, so an
  // unstyled hue would render as an unreadable bare chip (RIC-251 reuses `indigo`, which
  // globals.css already declares and no lifecycle status claims).
  it("styles every synthetic bucket's hue", () => {
    const STYLED = new Set(["grey", "blue", "indigo", "amber", "teal", "green", "red", "muted", "pink", "term"]);
    for (const bucket of [CUSTOM_STATUS, INTAKE_STATUS, TERMINAL_STATUS]) {
      expect(STYLED, `hue for ${bucket}`).toContain(statusColorClass(bucket));
    }
  });

  it("only uses hues that have a matching badge CSS rule", () => {
    const ALLOWED_HUES = new Set(["grey", "blue", "indigo", "amber", "teal", "green", "red", "muted"]);
    for (const hue of Object.values(STATUS_COLOR)) {
      expect(ALLOWED_HUES, `hue ${hue}`).toContain(hue);
    }
  });
});

// RIC-275: the launch sheet's one manual status move. Backlog and Todo are the two
// states nothing in the lifecycle moves a ticket between on its own — every other
// transition is Mojito's (a launch, a QA verdict), which is why only these two are
// offered by hand.
describe("manualMoveTarget", () => {
  it("offers Todo from Backlog and Backlog from Todo", () => {
    expect(manualMoveTarget("Backlog")).toBe("Todo");
    expect(manualMoveTarget("Todo")).toBe("Backlog");
  });

  it("offers nothing from any other status", () => {
    for (const s of ["In Progress", "To QA", "Done", "Canceled", "Duplicate", "Whatever", ""]) {
      expect(manualMoveTarget(s), `target for ${s}`).toBeNull();
    }
  });

  // The route validates the target against MANUAL_STATUSES, so a target this function
  // can produce but the server rejects would be a dead button.
  it("only ever names a status the server accepts", () => {
    for (const from of KNOWN_STATUSES) {
      const to = manualMoveTarget(from);
      if (to !== null) expect(MANUAL_STATUSES, `target for ${from}`).toContain(to);
    }
  });

  // The move is a toggle: every status it offers must itself offer the way back.
  it("is its own inverse", () => {
    for (const from of MANUAL_STATUSES) {
      expect(manualMoveTarget(manualMoveTarget(from)!)).toBe(from);
    }
  });
});
