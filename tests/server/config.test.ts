import { describe, it, expect } from "vitest";
import { loadConfig, resolveProjectsPath } from "@/server/config";

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
