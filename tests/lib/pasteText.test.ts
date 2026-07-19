import { describe, it, expect } from "vitest";
import { normalizePaste } from "@/lib/pasteText";

describe("normalizePaste", () => {
  it("returns the value verbatim when it has non-whitespace content", () => {
    expect(normalizePaste("hello")).toBe("hello");
  });

  it("preserves surrounding whitespace in a non-empty value", () => {
    expect(normalizePaste("  hi  ")).toBe("  hi  ");
  });

  it("preserves internal newlines of a multi-line paste", () => {
    expect(normalizePaste("line one\nline two")).toBe("line one\nline two");
  });

  it("returns null for an empty string", () => {
    expect(normalizePaste("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizePaste("   \n\t ")).toBeNull();
  });
});
