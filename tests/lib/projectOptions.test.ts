import { describe, expect, it } from "vitest";
import { GENERAL, GENERAL_LABEL, projectOptions } from "@/lib/projectOptions";

describe("projectOptions", () => {
  it("offers General first, then the configured projects in server order", () => {
    expect(projectOptions(["Mojito", "Atlas"])).toEqual([
      { value: GENERAL, label: GENERAL_LABEL },
      { value: "Mojito", label: "Mojito" },
      { value: "Atlas", label: "Atlas" },
    ]);
  });

  // The fetch answers a render after the sheet opens: until then General is the only
  // option, and it has to be a real one — a select with no options renders an empty field.
  it("still offers General while the project list is empty", () => {
    expect(projectOptions([])).toEqual([{ value: GENERAL, label: GENERAL_LABEL }]);
  });

  it("labels a project by its own name, so the search box matches what is on screen", () => {
    expect(projectOptions(["Mojito"])[1]).toEqual({ value: "Mojito", label: "Mojito" });
  });
});
