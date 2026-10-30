import { describe, expect, it } from "vitest";
import { isDocPath } from "../src/index";

describe("isDocPath", () => {
  it("accepts markdown paths, relative, absolute or under HOME", () => {
    for (const ok of ["README.md", "docs/a/B.MD", "/abs/x.md", "~/x.md", "./x.md", "with space.md", "spec-perché.md"]) {
      expect(isDocPath(ok), ok).toBe(true);
    }
  });

  it("rejects empty, non-markdown, NUL, parent segments and a bare .md", () => {
    for (const bad of ["", "x.txt", "x.md.bak", "a\0b.md", "../x.md", "docs/../x.md", "a/..", ".md", "docs/.md"]) {
      expect(isDocPath(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
