import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { configDir, loadConfig, resolveProjectsPath } from "@/server/config";

describe("loadConfig", () => {
  it("reads values from env with defaults", () => {
    const cfg = loadConfig({ MOJITO_TOKEN: "t", LINEAR_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    expect(cfg.token).toBe("t");
    expect(cfg.linearApiKey).toBe("k");
    expect(cfg.port).toBe(4711);
    expect(cfg.stateDir).toMatch(/mojito-state$/);
  });

  it("throws when the token is missing", () => {
    expect(() => loadConfig({ LINEAR_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toThrow(/MOJITO_TOKEN/);
  });
});

describe("resolveProjectsPath", () => {
  it("prefers MOJITO_PROJECTS when set", () => {
    const env = { MOJITO_PROJECTS: "/custom/mojito.json" } as unknown as NodeJS.ProcessEnv;
    expect(resolveProjectsPath(env)).toBe("/custom/mojito.json");
  });

  it("defaults to ~/.config/mojito/projects.json when MOJITO_PROJECTS is unset", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(resolveProjectsPath(env)).toMatch(/\.config\/mojito\/projects\.json$/);
  });
});

describe("configDir", () => {
  it("uses MOJITO_CONFIG_DIR when set", () => {
    expect(configDir({ MOJITO_CONFIG_DIR: "/cfg" } as unknown as NodeJS.ProcessEnv)).toBe("/cfg");
  });
  it("falls back to XDG_CONFIG_HOME/mojito", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/x" } as unknown as NodeJS.ProcessEnv))
      .toBe(join("/x", "mojito"));
  });
  it("defaults to ~/.config/mojito", () => {
    expect(configDir({} as unknown as NodeJS.ProcessEnv)).toBe(join(homedir(), ".config", "mojito"));
  });
});
