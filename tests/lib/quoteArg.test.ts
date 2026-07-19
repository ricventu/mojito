import { describe, it, expect } from "vitest";
import { quoteArg } from "@/lib/quoteArg";

describe("quoteArg", () => {
  it("leaves a whitespace-free arg unchanged", () => {
    expect(quoteArg("/repo/.mojito/pasted/s/abc.png")).toBe("/repo/.mojito/pasted/s/abc.png");
  });
  it("double-quotes an arg containing a space", () => {
    expect(quoteArg("/My Repo/img.png")).toBe('"/My Repo/img.png"');
  });
  it("double-quotes an arg containing a tab", () => {
    expect(quoteArg("a\tb")).toBe('"a\tb"');
  });
});
