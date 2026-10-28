import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, loadEnvFile } from "../src/config";
import { resetMojitoOnlyKeys, sanitizeEnv } from "../src/env/childEnv";

const KEYS = { MOJITO_TOKEN: "tok", LINEAR_API_KEY: "lin_api_x", HOME: "/home/me" };

describe("loadConfig", () => {
  it("throws naming the missing token", () => {
    expect(() => loadConfig({})).toThrow(/MOJITO_TOKEN/);
  });

  it("throws naming the missing Linear key", () => {
    expect(() => loadConfig({ MOJITO_TOKEN: "tok", HOME: "/home/me" })).toThrow(/LINEAR_API_KEY/);
  });

  it("applies the defaults", () => {
    const cfg = loadConfig(KEYS);
    expect(cfg).toEqual({
      port: 3100,
      host: "0.0.0.0",
      token: "tok",
      linearApiKey: "lin_api_x",
      home: "/home/me",
      stateDir: "/home/me/.local/state/mojito2",
      projectsJsonPath: "/home/me/.config/mojito/projects.json",
      repoRoot: resolve(import.meta.dirname, "../../.."),
    });
  });

  it("honours the overrides", () => {
    const cfg = loadConfig({
      ...KEYS,
      MOJITO2_PORT: "4000",
      MOJITO2_HOST: "127.0.0.1",
      MOJITO_STATE_DIR: "/var/mojito",
      MOJITO_PROJECTS: "/etc/projects.json",
    });
    expect(cfg.port).toBe(4000);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.stateDir).toBe("/var/mojito");
    expect(cfg.projectsJsonPath).toBe("/etc/projects.json");
  });

  // The old app's port and host sit in the same shared .env.local (8700 on 127.0.0.1 on the
  // Linux box); read by v2 they made the two apps collide.
  it("ignores the old app's MOJITO_PORT and MOJITO_HOST", () => {
    const cfg = loadConfig({ ...KEYS, MOJITO_PORT: "8700", MOJITO_HOST: "127.0.0.1" });
    expect(cfg.port).toBe(3100);
    expect(cfg.host).toBe("0.0.0.0");
  });

  it("falls back to the defaults on empty values", () => {
    const cfg = loadConfig({ ...KEYS, MOJITO2_PORT: "", MOJITO2_HOST: "" });
    expect(cfg.port).toBe(3100);
    expect(cfg.host).toBe("0.0.0.0");
  });
});

describe("loadEnvFile", () => {
  const touched = ["MJ_TEST_NEW", "MJ_TEST_KEEP"];
  afterEach(() => {
    for (const k of touched) delete process.env[k];
    resetMojitoOnlyKeys();
  });

  it("is a no-op when the file is missing", () => {
    expect(() => loadEnvFile(join(tmpdir(), "mj-does-not-exist", ".env.local"))).not.toThrow();
  });

  it("sets new keys, lets process.env win, and registers the new keys for scrubbing", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mj-env-")), ".env.local");
    writeFileSync(file, "MJ_TEST_NEW=from-file\nMJ_TEST_KEEP=from-file\n");
    process.env.MJ_TEST_KEEP = "from-shell";
    loadEnvFile(file);
    expect(process.env.MJ_TEST_NEW).toBe("from-file");
    expect(process.env.MJ_TEST_KEEP).toBe("from-shell");
    const clean = sanitizeEnv(process.env);
    expect(clean).not.toHaveProperty("MJ_TEST_NEW");
    expect(clean.MJ_TEST_KEEP).toBe("from-shell");
  });
});
