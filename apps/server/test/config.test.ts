import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, loadEnvFile, selfOrigin } from "../src/config";
import { resetMojitoOnlyKeys, sanitizeEnv } from "../src/env/childEnv";

const KEYS = { MOJITO_TOKEN: "tok", LINEAR_API_KEY: "lin_api_x", HOME: "/home/me" };

describe("selfOrigin", () => {
  it("reaches a wildcard bind through loopback", () => {
    expect(selfOrigin({ host: "0.0.0.0", port: 3100 })).toBe("http://127.0.0.1:3100");
    expect(selfOrigin({ host: "::", port: 3100 })).toBe("http://127.0.0.1:3100");
  });

  it("uses any other host as configured, bracketing IPv6", () => {
    expect(selfOrigin({ host: "127.0.0.1", port: 3100 })).toBe("http://127.0.0.1:3100");
    expect(selfOrigin({ host: "100.64.0.7", port: 4000 })).toBe("http://100.64.0.7:4000");
    expect(selfOrigin({ host: "::1", port: 3100 })).toBe("http://[::1]:3100");
  });
});

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
      port: 8700,
      host: "127.0.0.1",
      token: "tok",
      linearApiKey: "lin_api_x",
      home: "/home/me",
      stateDir: "/home/me/.local/state/mojito",
      projectsJsonPath: "/home/me/.config/mojito/projects.json",
      repoRoot: resolve(import.meta.dirname, "../../.."),
    });
  });

  it("honours the overrides", () => {
    const cfg = loadConfig({
      ...KEYS,
      MOJITO_PORT: "4000",
      MOJITO_HOST: "0.0.0.0",
      MOJITO_STATE_DIR: "/var/mojito",
      MOJITO_PROJECTS: "/etc/projects.json",
    });
    expect(cfg.port).toBe(4000);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.stateDir).toBe("/var/mojito");
    expect(cfg.projectsJsonPath).toBe("/etc/projects.json");
  });

  it("falls back to the defaults on empty values", () => {
    const cfg = loadConfig({ ...KEYS, MOJITO_PORT: "", MOJITO_HOST: "" });
    expect(cfg.port).toBe(8700);
    expect(cfg.host).toBe("127.0.0.1");
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
