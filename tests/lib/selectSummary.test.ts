import { describe, expect, it } from "vitest";
import { multiSelectSummary, optionLabel, type SelectOption } from "@/lib/selectSummary";

const options: SelectOption[] = [
  { value: "__general__", label: "General (home)" },
  { value: "Mojito", label: "Mojito" },
  { value: "Fornace", label: "Fornace" },
];

describe("optionLabel", () => {
  it("reads a value's label, which is what a sentinel value exists for", () => {
    expect(optionLabel("__general__", options)).toBe("General (home)");
  });

  it("falls back to the value itself for an option that is gone", () => {
    expect(optionLabel("Retired", options)).toBe("Retired");
  });
});

describe("multiSelectSummary", () => {
  it("says what no selection means, rather than showing an empty field", () => {
    expect(multiSelectSummary([], options, "All projects")).toBe("All projects");
  });

  it("names a single selection", () => {
    expect(multiSelectSummary(["Mojito"], options, "All projects")).toBe("Mojito");
  });

  it("names the first and counts the rest, so the trigger stays one line", () => {
    expect(multiSelectSummary(["Mojito", "Fornace"], options, "All projects")).toBe("Mojito +1");
    expect(multiSelectSummary(["Mojito", "Fornace", "Atlas"], options, "All projects")).toBe("Mojito +2");
  });

  it("still names a project the options no longer offer, since it is still filtering", () => {
    expect(multiSelectSummary(["Retired"], options, "All projects")).toBe("Retired");
  });

  it("keeps the given order — the trigger reports the selection, it does not sort it", () => {
    expect(multiSelectSummary(["Fornace", "Mojito"], options, "All projects")).toBe("Fornace +1");
  });
});
