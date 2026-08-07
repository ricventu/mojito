import { describe, it, expect } from "vitest";
import { resolveRepoFromMap, listMappedProjects, resolvePathForProject, teamKeyForProject } from "@/server/projects";

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

describe("listMappedProjects", () => {
  const map = {
    ENG: "/code/backend",
    WEB: { path: "/code/web", projects: { "Design System": "/code/ds", "Marketing": "/code/mkt" } },
    OPS: { path: "/code/ops" },
  };
  it("flattens string, object-with-projects, and path-only entries, sorted by name", () => {
    expect(listMappedProjects(map)).toEqual([
      { name: "Design System", path: "/code/ds" },
      { name: "ENG", path: "/code/backend" },
      { name: "Marketing", path: "/code/mkt" },
      { name: "OPS", path: "/code/ops" },
    ]);
  });
  it("returns an empty array for an empty map", () => {
    expect(listMappedProjects({})).toEqual([]);
  });
});

describe("resolvePathForProject", () => {
  const map = { WEB: { path: "/code/web", projects: { "Design System": "/code/ds" } } };
  it("resolves a named project", () => {
    expect(resolvePathForProject(map, "Design System")).toBe("/code/ds");
  });
  it("returns null for an unmapped name", () => {
    expect(resolvePathForProject(map, "Nope")).toBeNull();
  });
});

describe("teamKeyForProject", () => {
  const map = {
    ENG: "/code/backend",
    WEB: { path: "/code/web", projects: { "Design System": "/code/ds", Marketing: "/code/mkt" } },
  };
  it("returns the team key whose projects map contains the name", () => {
    expect(teamKeyForProject(map, "Design System")).toBe("WEB");
  });
  it("falls back to the map's first key when the name is not found", () => {
    expect(teamKeyForProject(map, "Nope")).toBe("ENG");
  });
  it("falls back to the map's first key when projectName is null", () => {
    expect(teamKeyForProject(map, null)).toBe("ENG");
  });
  it("returns null for an empty map", () => {
    expect(teamKeyForProject({}, null)).toBeNull();
    expect(teamKeyForProject({}, "Anything")).toBeNull();
  });
});
