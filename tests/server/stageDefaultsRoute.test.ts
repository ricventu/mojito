import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "@/app/api/config/stage-defaults/route";
import { _resetStageDefaultsCache } from "@/server/stageDefaults";

const TOKEN = "test-token";
function req(method: string, body?: unknown, auth = true): Request {
  return new Request("http://localhost/api/config/stage-defaults", {
    method,
    headers: auth ? { "x-mojito-token": TOKEN, "Content-Type": "application/json" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-cfg-"));
  process.env.MOJITO_CONFIG_DIR = dir;
  process.env.MOJITO_TOKEN = TOKEN;
  process.env.LINEAR_API_KEY = "k";
  _resetStageDefaultsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/config/stage-defaults", () => {
  it("401 without a token", async () => {
    expect((await GET(req("GET", undefined, false))).status).toBe(401);
  });
  it("returns the effective table (built-ins when no file)", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["In Progress"]).toEqual({ model: "opus", effort: "high" });
    expect(body["Todo"]).toEqual({ model: "opus", effort: "high" });
  });
});

describe("PUT /api/config/stage-defaults", () => {
  it("401 without a token", async () => {
    expect((await PUT(req("PUT", { "In Progress": { model: "opus", effort: "medium" } }, false))).status).toBe(401);
  });
  it("persists a valid override and returns the new effective table", async () => {
    const res = await PUT(req("PUT", { "In Progress": { model: "opus", effort: "medium" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body["In Progress"]).toEqual({ model: "opus", effort: "medium" });
    // A fresh GET reflects it too.
    const after = await (await GET(req("GET"))).json();
    expect(after["In Progress"]).toEqual({ model: "opus", effort: "medium" });
  });
  it("422 on an invalid model", async () => {
    const res = await PUT(req("PUT", { "In Progress": { model: "gpt", effort: "low" } }));
    expect(res.status).toBe(422);
  });
  it("422 on an unknown status", async () => {
    const res = await PUT(req("PUT", { "Nope": { model: "opus", effort: "low" } }));
    expect(res.status).toBe(422);
  });
  it("400 on bad json", async () => {
    const bad = new Request("http://localhost/api/config/stage-defaults", {
      method: "PUT", headers: { "x-mojito-token": TOKEN, "Content-Type": "application/json" }, body: "{ oops",
    });
    expect((await PUT(bad)).status).toBe(400);
  });
});
