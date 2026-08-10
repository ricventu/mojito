import { describe, it, expect } from "vitest";
import { tabTitle } from "@/lib/tabTitle";

describe("tabTitle", () => {
  it("titles the unified tickets tab", () => {
    expect(tabTitle("tickets")).toBe("Tickets — Mojito");
  });

  it("titles the stacks tab", () => {
    expect(tabTitle("stacks")).toBe("Stacks — Mojito");
  });

  it("falls back to the tickets title for any other value", () => {
    expect(tabTitle("")).toBe("Tickets — Mojito");
    expect(tabTitle("whatever")).toBe("Tickets — Mojito");
  });

  // A browser that stored "sessions" before the views merged must land on the unified
  // list, which is what page.tsx renders for every value that is not "stacks".
  it("gives a stored 'sessions' tab the tickets title", () => {
    expect(tabTitle("sessions")).toBe("Tickets — Mojito");
  });
});
