import { describe, expect, it } from "vitest";
import { setup } from "./setup";

const web = { name: "Web", path: "/repo/web", teamKey: "RIC" };

describe("GET /api/projects", () => {
  it("lists the projects", async () => {
    const { req, projects } = setup();
    projects.upsert(web);
    const res = await req("/api/projects");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([web]);
  });
});

describe("POST /api/projects", () => {
  it("creates a project and refreshes the board", async () => {
    const { req, projects, refresh } = setup();
    const res = await req("/api/projects", { method: "POST", json: web });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(web);
    expect(projects.get("Web")).toEqual(web);
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses a relative path", async () => {
    const { req, projects } = setup();
    const res = await req("/api/projects", { method: "POST", json: { ...web, path: "repo/web" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/path/);
    expect(projects.isEmpty()).toBe(true);
  });

  it("refuses a path that does not exist", async () => {
    const { req, projects, exists } = setup();
    exists.mockReturnValue(false);
    const res = await req("/api/projects", { method: "POST", json: web });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "project path not found: /repo/web" });
    expect(exists).toHaveBeenCalledWith("/repo/web");
    expect(projects.isEmpty()).toBe(true);
  });

  it("keeps a path under the home directory as typed, checking it expanded", async () => {
    const { req, projects, exists } = setup();
    const res = await req("/api/projects", { method: "POST", json: { ...web, path: "~/repo/web" } });
    expect(res.status).toBe(201);
    expect(exists).toHaveBeenCalledWith("/home/me/repo/web");
    expect(projects.get("Web")?.path).toBe("~/repo/web");
  });

  it("names the expanded path when a home path does not exist", async () => {
    const { req, exists } = setup();
    exists.mockReturnValue(false);
    const res = await req("/api/projects", { method: "POST", json: { ...web, path: "~/gone" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "project path not found: /home/me/gone" });
  });

  it("refuses a name that already exists", async () => {
    const { req, projects } = setup();
    projects.upsert(web);
    const res = await req("/api/projects", { method: "POST", json: { ...web, path: "/repo/other" } });
    expect(res.status).toBe(409);
    expect(projects.get("Web")?.path).toBe("/repo/web");
  });

  it("refuses a malformed body with a readable message", async () => {
    const { req } = setup();
    const res = await req("/api/projects", { method: "POST", json: { ...web, teamKey: "ric" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/teamKey/);
  });

  it("refuses a body that is not JSON", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "x-mojito-token": "tok", "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid JSON body" });
  });
});

describe("PUT /api/projects/:name", () => {
  it("updates the path in place", async () => {
    const { req, projects, refresh } = setup();
    projects.upsert(web);
    const res = await req("/api/projects/Web", { method: "PUT", json: { ...web, path: "/repo/web2" } });
    expect(res.status).toBe(200);
    expect(projects.get("Web")?.path).toBe("/repo/web2");
    expect(refresh).toHaveBeenCalled();
  });

  it("renames a project", async () => {
    const { req, projects } = setup();
    projects.upsert(web);
    const res = await req("/api/projects/Web", { method: "PUT", json: { ...web, name: "Site" } });
    expect(res.status).toBe(200);
    expect(projects.get("Web")).toBeNull();
    expect(projects.get("Site")).toEqual({ ...web, name: "Site" });
  });

  it("decodes the name in the path", async () => {
    const { req, projects } = setup();
    projects.upsert({ ...web, name: "My Web" });
    const res = await req("/api/projects/My%20Web", { method: "PUT", json: { ...web, name: "My Web", path: "/x" } });
    expect(res.status).toBe(200);
    expect(projects.get("My Web")?.path).toBe("/x");
  });

  it("answers 404 for a project that does not exist", async () => {
    const { req, projects } = setup();
    const res = await req("/api/projects/Web", { method: "PUT", json: web });
    expect(res.status).toBe(404);
    expect(projects.isEmpty()).toBe(true);
  });

  it("refuses a rename onto an existing name", async () => {
    const { req, projects } = setup();
    projects.upsert(web);
    projects.upsert({ name: "Site", path: "/repo/site", teamKey: "RIC" });
    const res = await req("/api/projects/Web", { method: "PUT", json: { ...web, name: "Site" } });
    expect(res.status).toBe(409);
    expect(projects.get("Web")).toEqual(web);
    expect(projects.get("Site")?.path).toBe("/repo/site");
  });

  it("refuses a path that does not exist", async () => {
    const { req, projects, exists } = setup();
    projects.upsert(web);
    exists.mockReturnValue(false);
    const res = await req("/api/projects/Web", { method: "PUT", json: { ...web, path: "/gone" } });
    expect(res.status).toBe(400);
    expect(projects.get("Web")?.path).toBe("/repo/web");
  });
});

describe("DELETE /api/projects/:name", () => {
  it("removes the project and refreshes the board", async () => {
    const { req, projects, refresh } = setup();
    projects.upsert(web);
    const res = await req("/api/projects/Web", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(projects.isEmpty()).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it("answers 404 for a project that does not exist", async () => {
    const { req, refresh } = setup();
    const res = await req("/api/projects/Web", { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(refresh).not.toHaveBeenCalled();
  });
});
