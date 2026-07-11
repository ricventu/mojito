import { describe, it, expect } from "vitest";
import { tokenFromHeaders, tokenFromUrl } from "@/server/auth";

describe("auth", () => {
  it("validates a header token", () => {
    expect(tokenFromHeaders(new Headers({ "x-mojito-token": "s" }), "s")).toBe(true);
    expect(tokenFromHeaders(new Headers({ "x-mojito-token": "x" }), "s")).toBe(false);
    expect(tokenFromHeaders(new Headers(), "s")).toBe(false);
  });
  it("validates a url token", () => {
    expect(tokenFromUrl("/ws/events?token=s", "s")).toBe(true);
    expect(tokenFromUrl("/ws/events?token=x", "s")).toBe(false);
  });
});
