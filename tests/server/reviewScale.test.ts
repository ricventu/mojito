import { describe, it, expect } from "vitest";
import {
  parseShortstat, detectDefaultBranch, branchChangedLines, scaleReviewProfile,
  SMALL_DIFF_LINES, MEDIUM_DIFF_LINES,
} from "@/server/reviewScale";

describe("parseShortstat", () => {
  it("sums insertions and deletions", () => {
    expect(parseShortstat(" 3 files changed, 120 insertions(+), 45 deletions(-)")).toBe(165);
  });
  it("handles insertions only", () => {
    expect(parseShortstat(" 1 file changed, 2 insertions(+)")).toBe(2);
  });
  it("handles deletions only", () => {
    expect(parseShortstat(" 1 file changed, 7 deletions(-)")).toBe(7);
  });
  it("returns 0 for an empty diff", () => {
    expect(parseShortstat("")).toBe(0);
  });
});

describe("detectDefaultBranch", () => {
  it("prefers origin/HEAD", () => {
    const run = (_c: string, args: string[]) => {
      if (args.includes("symbolic-ref")) return "origin/main\n";
      throw new Error("unexpected");
    };
    expect(detectDefaultBranch(run)).toBe("main");
  });
  it("falls back to a local main", () => {
    const run = (_c: string, args: string[]) => {
      if (args.includes("symbolic-ref")) throw new Error("no origin/HEAD");
      if (args.includes("refs/heads/main")) return "abc123\n";
      throw new Error("unexpected");
    };
    expect(detectDefaultBranch(run)).toBe("main");
  });
  it("falls back to a local master", () => {
    const run = (_c: string, args: string[]) => {
      if (args.includes("symbolic-ref")) throw new Error("no origin/HEAD");
      if (args.includes("refs/heads/main")) throw new Error("no main");
      if (args.includes("refs/heads/master")) return "abc123\n";
      throw new Error("unexpected");
    };
    expect(detectDefaultBranch(run)).toBe("master");
  });
  it("returns null when nothing resolves", () => {
    expect(detectDefaultBranch(() => { throw new Error("git failed"); })).toBeNull();
  });
});

describe("branchChangedLines", () => {
  it("counts the three-dot diff against the default branch", () => {
    const run = (_c: string, args: string[]) => {
      if (args.includes("symbolic-ref")) return "origin/main\n";
      if (args.includes("--shortstat")) {
        expect(args).toContain("main...HEAD");
        return " 2 files changed, 30 insertions(+), 10 deletions(-)\n";
      }
      throw new Error("unexpected");
    };
    expect(branchChangedLines("/wt", run)).toBe(40);
  });
  it("returns null when the default branch is unknown", () => {
    expect(branchChangedLines("/wt", () => { throw new Error("git failed"); })).toBeNull();
  });
});

describe("scaleReviewProfile", () => {
  it("small diff downgrades to sonnet/medium", () => {
    expect(scaleReviewProfile("opus", "xhigh", SMALL_DIFF_LINES - 1))
      .toEqual({ model: "sonnet", effort: "medium", scaled: true });
  });
  it("medium diff keeps the model, caps effort at high", () => {
    expect(scaleReviewProfile("opus", "xhigh", MEDIUM_DIFF_LINES - 1))
      .toEqual({ model: "opus", effort: "high", scaled: true });
  });
  it("large diff is untouched", () => {
    expect(scaleReviewProfile("opus", "xhigh", MEDIUM_DIFF_LINES))
      .toEqual({ model: "opus", effort: "xhigh", scaled: false });
  });
  it("never upgrades model or effort", () => {
    expect(scaleReviewProfile("sonnet", "low", SMALL_DIFF_LINES - 1))
      .toEqual({ model: "sonnet", effort: "low", scaled: false });
    expect(scaleReviewProfile("opus", "high", MEDIUM_DIFF_LINES - 1))
      .toEqual({ model: "opus", effort: "high", scaled: false });
  });
});
