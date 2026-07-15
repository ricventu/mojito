import { describe, it, expect } from "vitest";
import { readPersisted } from "@/lib/usePersistedState";

describe("readPersisted", () => {
  it("returns the stored value when the key is present", () => {
    const storage = { getItem: (k: string) => (k === "mojito-tab" ? "sessions" : null) };
    expect(readPersisted(storage, "mojito-tab", "tickets")).toBe("sessions");
  });

  it("falls back to the initial value when the key is absent", () => {
    const storage = { getItem: () => null };
    expect(readPersisted(storage, "mojito-tab", "tickets")).toBe("tickets");
  });

  it("falls back to the initial value when storage is undefined (SSR guard)", () => {
    expect(readPersisted(undefined, "mojito-tab", "tickets")).toBe("tickets");
  });
});
