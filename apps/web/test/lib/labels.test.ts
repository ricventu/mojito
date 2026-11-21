import { describe, expect, it } from "vitest";
import type { TicketSummary } from "@mojito/shared";
import { labelColor, sheetLabels } from "@/lib/labels";

describe("labelColor", () => {
  it("answers the label's #rrggbb colour", () => {
    expect(labelColor({ labelColors: { Bug: "#EB5757" } }, "Bug")).toBe("#eb5757");
  });

  it("answers null without colours (an older peer), for a missing label or a bad value", () => {
    expect(labelColor({}, "Bug")).toBeNull();
    expect(labelColor({ labelColors: { Bug: "#eb5757" } }, "Feature")).toBeNull();
    expect(labelColor({ labelColors: { Bug: "red;background:url(x)" } }, "Bug")).toBeNull();
    expect(labelColor({ labelColors: { Bug: 5 as unknown as string } }, "Bug")).toBeNull();
  });

  it("never reads an inherited key", () => {
    expect(labelColor({ labelColors: {} }, "toString")).toBeNull();
  });
});

describe("sheetLabels", () => {
  const t = (labels: string[], labelColors?: Record<string, string>): TicketSummary => ({
    identifier: "RIC-1",
    title: "t",
    url: "u",
    statusName: "Todo",
    statusType: "unstarted",
    project: "Alpha",
    labels,
    labelColors,
    assignedToMe: false,
  });

  it("offers each label of the tickets once, sorted for display, with its colour", () => {
    expect(sheetLabels([t(["Feature", "bug"]), t(["Feature"], { Feature: "#BB87FC" })], [])).toEqual([
      { name: "bug", color: null },
      { name: "Feature", color: "#bb87fc" },
    ]);
  });

  it("keeps a selected label no ticket carries any more", () => {
    expect(sheetLabels([t(["Bug"])], ["Gone"])).toEqual([
      { name: "Bug", color: null },
      { name: "Gone", color: null },
    ]);
  });

  it("is empty without tickets or selection", () => {
    expect(sheetLabels([], [])).toEqual([]);
  });
});
