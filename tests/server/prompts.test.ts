import { describe, it, expect } from "vitest";
import { buildWorkPrompt, buildConflictPrompt } from "@/server/prompts";

const vars = { ticket: "RIC-46", contextPath: "/state/context/s1.json", resultPath: "/state/results/s1.json" };

describe("prompt builder", () => {
  it("interpolates all placeholders in the work prompt", () => {
    const p = buildWorkPrompt(vars);
    expect(p).toContain("RIC-46");
    expect(p).toContain("/state/context/s1.json");
    expect(p).toContain("/state/results/s1.json");
    expect(p).not.toContain("{{");
  });
  it("interpolates all placeholders in the conflict prompt", () => {
    const p = buildConflictPrompt(vars);
    expect(p).toContain("RIC-46");
    expect(p).not.toContain("{{");
  });
  it("forbids Linear access and requires the result file in both prompts", () => {
    for (const p of [buildWorkPrompt(vars), buildConflictPrompt(vars)]) {
      expect(p.toLowerCase()).toContain("never use any linear");
      expect(p).toContain('"ready-for-qa"');
    }
  });
});
