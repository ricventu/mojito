import { describe, expect, it } from "vitest";
import { tokenMatches } from "../src/token";

describe("tokenMatches", () => {
  it("accepts the token and nothing else", () => {
    expect(tokenMatches("s3cret", "s3cret")).toBe(true);
    expect(tokenMatches("s3creT", "s3cret")).toBe(false);
    expect(tokenMatches("s3cre", "s3cret")).toBe(false);
    expect(tokenMatches("s3cret-and-more", "s3cret")).toBe(false);
    expect(tokenMatches("", "s3cret")).toBe(false);
  });

  it("refuses a missing token", () => {
    expect(tokenMatches(undefined, "s3cret")).toBe(false);
    expect(tokenMatches(null, "s3cret")).toBe(false);
  });
});
