import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PUT } from "@/app/api/config/review-scale/route";
import { readAutoScale, writeAutoScale, scaleConfigPath, _resetScaleSettingsCache } from "@/server/scaleSettings";

const TOKEN = "test-token";
function req(method: string, body?: unknown, auth = true): Request {
  return new Request("http://localhost/api/config/review-scale", {
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
  _resetScaleSettingsCache();
});
afterEach(() => {
  delete process.env.MOJITO_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
  _resetScaleSettingsCache();
});

describe("scaleSettings", () => {
  it("defaults to enabled when the file is missing", () => {
    expect(readAutoScale()).toBe(true);
  });
  it("round-trips a write", () => {
    writeAutoScale(false);
    _resetScaleSettingsCache();
    expect(readAutoScale()).toBe(false);
  });
  it("falls back to enabled on corrupt content", () => {
    writeFileSync(scaleConfigPath(), "not json");
    expect(readAutoScale()).toBe(true);
  });
  it("falls back to enabled on a non-boolean value", () => {
    writeFileSync(scaleConfigPath(), JSON.stringify({ autoScale: "no" }));
    expect(readAutoScale()).toBe(true);
  });
});

describe("/api/config/review-scale", () => {
  it("401 without a token", async () => {
    expect((await GET(req("GET", undefined, false))).status).toBe(401);
    expect((await PUT(req("PUT", { autoScale: false }, false))).status).toBe(401);
  });
  it("GET returns the current value", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autoScale: true });
  });
  it("PUT persists and echoes the value", async () => {
    const res = await PUT(req("PUT", { autoScale: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ autoScale: false });
    _resetScaleSettingsCache();
    expect(readAutoScale()).toBe(false);
  });
  it("PUT rejects a non-boolean", async () => {
    expect((await PUT(req("PUT", { autoScale: "yes" }))).status).toBe(422);
    expect((await PUT(req("PUT", {}))).status).toBe(422);
  });
});
