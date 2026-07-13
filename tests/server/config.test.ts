import { describe, it, expect } from "vitest";
import { loadConfig } from "@/server/config";

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
