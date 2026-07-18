import { describe, it, expect } from "vitest";
import { tabTitle } from "@/lib/tabTitle";

describe("tabTitle", () => {
  it("titles the tickets tab", () => {
    expect(tabTitle("tickets")).toBe("Tickets — Mojito");
  });

  it("titles the sessions tab", () => {
    expect(tabTitle("sessions")).toBe("Sessions — Mojito");
  });

  it("falls back to the tickets title for any other value", () => {
    expect(tabTitle("")).toBe("Tickets — Mojito");
    expect(tabTitle("whatever")).toBe("Tickets — Mojito");
  });
});
