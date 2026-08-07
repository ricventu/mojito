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
  it("prefers MOJITO_PROJECTS over every other rung", () => {
    const env = { MOJITO_PROJECTS: "/custom/mojito.json", LIME_PROJECTS: "/custom/lime.json" } as unknown as NodeJS.ProcessEnv;
    expect(resolveProjectsPath(env, () => true)).toBe("/custom/mojito.json");
  });

  it("falls back to LIME_PROJECTS (legacy env) when MOJITO_PROJECTS is unset", () => {
    const env = { LIME_PROJECTS: "/custom/lime.json" } as unknown as NodeJS.ProcessEnv;
    expect(resolveProjectsPath(env, () => true)).toBe("/custom/lime.json");
  });

  it("falls back to ~/.config/mojito/projects.json when it exists and no env vars are set", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    const path = resolveProjectsPath(env, () => true);
    expect(path).toMatch(/\.config\/mojito\/projects\.json$/);
  });

  it("falls back to the legacy ~/.claude/lime-projects.json when nothing else applies", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    const path = resolveProjectsPath(env, () => false);
    expect(path).toMatch(/\.claude\/lime-projects\.json$/);
  });
});
