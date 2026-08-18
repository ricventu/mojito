import { describe, it, expect } from "vitest";
import { tabTitle } from "@/lib/tabTitle";

describe("tabTitle", () => {
  it("titles the unified tickets tab", () => {
    expect(tabTitle("list")).toBe("Tickets — Mojito");
  });

  it("titles the stacks tab", () => {
    expect(tabTitle("stacks")).toBe("Stacks — Mojito");
  });

  it("falls back to the tickets title for any other value", () => {
    expect(tabTitle("")).toBe("Tickets — Mojito");
    expect(tabTitle("whatever")).toBe("Tickets — Mojito");
  });

  // The docs overlay opened from the list keeps the list's title, which is what
  // page.tsx renders for every view kind that is not "stacks".
  it("gives the docs overlay the tickets title", () => {
    expect(tabTitle("docs")).toBe("Tickets — Mojito");
  });
});
