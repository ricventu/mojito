import { describe, it, expect } from "vitest";
import { buildWorkPrompt, buildMergeFixPrompt } from "@/server/prompts";

const vars = { ticket: "RIC-46", contextPath: "/state/context/s1.json", resultPath: "/state/results/s1.json" };
const fixVars = { ...vars, mergeMode: "local" as const, blocker: "CONFLICT (content): src/a.ts" };

describe("prompt builder", () => {
  it("interpolates all placeholders in the work prompt", () => {
    const p = buildWorkPrompt(vars);
    expect(p).toContain("RIC-46");
    expect(p).toContain("/state/context/s1.json");
    expect(p).toContain("/state/results/s1.json");
    expect(p).not.toContain("{{");
  });
  it("interpolates all placeholders in the merge-fix prompt, including the blocker", () => {
    const p = buildMergeFixPrompt(fixVars);
    expect(p).toContain("RIC-46");
    expect(p).toContain("CONFLICT (content): src/a.ts");
    expect(p).not.toContain("{{");
  });
  it("forbids Linear access in both prompts", () => {
    for (const p of [buildWorkPrompt(vars), buildMergeFixPrompt(fixVars)]) {
      expect(p.toLowerCase()).toContain("never use any linear");
    }
  });
  it("keeps the result contracts distinct: work reports ready-for-qa, merge-fix reports merged", () => {
    expect(buildWorkPrompt(vars)).toContain('"ready-for-qa"');
    const fix = buildMergeFixPrompt(fixVars);
    expect(fix).toContain('"merged"');
    expect(fix).not.toContain('"ready-for-qa"');
  });
  it("selects the completion step from the approved merge mode", () => {
    expect(buildMergeFixPrompt(fixVars)).toContain("--ff-only");
    expect(buildMergeFixPrompt(fixVars)).not.toContain("gh pr create");
    const mr = buildMergeFixPrompt({ ...fixVars, mergeMode: "mr" });
    expect(mr).toContain("gh pr create");
    expect(mr).not.toContain("--ff-only");
  });
  it("sanitizes a blocker instead of failing the launch", () => {
    const p = buildMergeFixPrompt({ ...fixVars, blocker: "weird {{TICKET}} output" });
    expect(p).not.toContain("{{");
    const empty = buildMergeFixPrompt({ ...fixVars, blocker: "   " });
    expect(empty).toContain("(no diagnostic output)");
  });

  it("tells the work session to read the assets Mojito downloaded", () => {
    const p = buildWorkPrompt(vars);
    expect(p).toContain("localPath");
    expect(p).toContain("Read tool");
    expect(p).toContain("attachments");
  });

  it("leaves the merge-fix prompt free of the asset paragraph", () => {
    expect(buildMergeFixPrompt(fixVars)).not.toContain("localPath");
  });
});
