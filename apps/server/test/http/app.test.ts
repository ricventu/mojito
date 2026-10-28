import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOKEN, meta, setup } from "./setup";

describe("auth", () => {
  it("refuses an /api request without the token", async () => {
    const { app } = setup();
    const res = await app.request("/api/projects");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("refuses a wrong token", async () => {
    const { app } = setup();
    const res = await app.request("/api/sessions", { headers: { "x-mojito-token": "nope" } });
    expect(res.status).toBe(401);
  });

  it("does not take the token from the query string", async () => {
    const { app } = setup();
    const res = await app.request(`/api/projects?token=${TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("answers /api/health without a token", async () => {
    const { app } = setup();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("POST /api/hook", () => {
  it("needs the token like every other route", async () => {
    const { app } = setup();
    const res = await app.request("/api/hook?session=mj-RIC-1&event=Stop", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("answers 200 for an unknown session and changes nothing", async () => {
    const { req, events } = setup();
    const res = await req("/api/hook?session=mj-NOPE-1&event=Stop", { method: "POST", json: {} });
    expect(res.status).toBe(200);
    expect(events).toEqual([]);
  });

  it("answers 200 with no query at all", async () => {
    const { req } = setup();
    const res = await req("/api/hook", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("applies the hook to a known session", async () => {
    const { req, sessions, events } = setup();
    sessions.insert(meta({ id: "mj-web-a1b2c3", kind: "claude", ticket: null, state: "starting" }));
    const res = await req("/api/hook?session=mj-web-a1b2c3&event=SessionStart", { method: "POST", json: {} });
    expect(res.status).toBe(200);
    expect(sessions.get("mj-web-a1b2c3")?.state).toBe("running");
    expect(events.map((e) => e.type)).toEqual(["session.updated"]);
  });

  it("hands the hook's JSON body to the handler: a /clear's SessionEnd ends nothing", async () => {
    const { req, sessions, events } = setup();
    sessions.insert(meta({ id: "mj-web-a1b2c3", kind: "claude", ticket: null, state: "idle" }));
    const res = await req("/api/hook?session=mj-web-a1b2c3&event=SessionEnd", {
      method: "POST",
      json: { hook_event_name: "SessionEnd", reason: "clear" },
    });
    expect(res.status).toBe(200);
    expect(sessions.get("mj-web-a1b2c3")?.state).toBe("idle");
    expect(events).toEqual([]);
  });

  it("treats a malformed body as no body", async () => {
    const { app, sessions } = setup();
    sessions.insert(meta({ id: "mj-web-a1b2c3", kind: "claude", ticket: null, state: "running" }));
    const res = await app.request("/api/hook?session=mj-web-a1b2c3&event=SessionEnd", {
      method: "POST",
      headers: { "x-mojito-token": TOKEN, "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(200);
    expect(sessions.get("mj-web-a1b2c3")?.state).toBe("ended");
  });
});

describe("unknown routes", () => {
  it("answers an unknown /api path with JSON 404", async () => {
    const { req } = setup();
    const res = await req("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

describe("static files", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mojito-static-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Mojito</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("serves index.html at /", async () => {
    const { app } = setup({ staticDir: dir });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("<title>Mojito</title>");
  });

  it("serves a real asset as itself", async () => {
    const { app } = setup({ staticDir: dir });
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  it("falls back to index.html for a client route", async () => {
    const { app } = setup({ staticDir: dir });
    const res = await app.request("/session/abc");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Mojito</title>");
  });

  it("never answers an /api path with index.html", async () => {
    const { req } = setup({ staticDir: dir });
    const res = await req("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("never answers a /ws path with index.html", async () => {
    const { app } = setup({ staticDir: dir });
    const res = await app.request("/ws/events");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<title>Mojito</title>");
  });

  it("serves nothing without a staticDir", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });
});
