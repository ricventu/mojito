import { describe, it, expect } from "vitest";
import { slashForStatus } from "@/server/stageCommand";

describe("slashForStatus", () => {
  it("maps each lifecycle status to its stage skill", () => {
    expect(slashForStatus("Backlog")).toBe("/lime-design");
    expect(slashForStatus("Todo")).toBe("/lime-design");
    expect(slashForStatus("To Code")).toBe("/lime-implement");
    expect(slashForStatus("To Review")).toBe("/lime-review");
    expect(slashForStatus("To QA")).toBe("/lime-qa");
    expect(slashForStatus("To Merge")).toBe("/lime-merge");
  });
  it("falls back to the dispatcher for terminal statuses", () => {
    expect(slashForStatus("Done")).toBe("/lime-next");
    expect(slashForStatus("Canceled")).toBe("/lime-next");
    expect(slashForStatus("Duplicate")).toBe("/lime-next");
  });
  it("falls back to the dispatcher for unknown statuses", () => {
    expect(slashForStatus("Planned")).toBe("/lime-next");
    expect(slashForStatus("")).toBe("/lime-next");
  });
});
