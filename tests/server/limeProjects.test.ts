import { describe, it, expect } from "vitest";
import { resolveRepoFromMap } from "@/server/limeProjects";

describe("resolveRepoFromMap", () => {
  const map = {
    ENG: "/code/backend",
    WEB: { path: "/code/web", projects: { "Design System": "/code/ds" } },
  };
  it("resolves a string team entry", () => {
    expect(resolveRepoFromMap(map, "ENG", null)).toBe("/code/backend");
  });
  it("resolves the default path of an object entry", () => {
    expect(resolveRepoFromMap(map, "WEB", "Other")).toBe("/code/web");
  });
  it("resolves a project override", () => {
    expect(resolveRepoFromMap(map, "WEB", "Design System")).toBe("/code/ds");
  });
  it("returns null for an unknown team", () => {
    expect(resolveRepoFromMap(map, "NOPE", null)).toBeNull();
  });
});
