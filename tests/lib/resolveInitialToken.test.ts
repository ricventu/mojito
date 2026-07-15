import { describe, it, expect } from "vitest";
import { resolveInitialToken } from "@/lib/resolveInitialToken";

describe("resolveInitialToken", () => {
  it("uses the token from the URL when present", () => {
    expect(resolveInitialToken("?token=abc", null)).toEqual({ token: "abc", fromUrl: true });
  });

  it("URL token wins over a stored token", () => {
    expect(resolveInitialToken("?token=fromUrl", "stored")).toEqual({ token: "fromUrl", fromUrl: true });
  });

  it("preserves other query params alongside the token", () => {
    expect(resolveInitialToken("?foo=1&token=abc&bar=2", null)).toEqual({ token: "abc", fromUrl: true });
  });

  it("falls back to the stored token when the URL has none", () => {
    expect(resolveInitialToken("", "stored")).toEqual({ token: "stored", fromUrl: false });
    expect(resolveInitialToken("?foo=1", "stored")).toEqual({ token: "stored", fromUrl: false });
  });

  it("returns an empty token (login screen) when nothing is available", () => {
    expect(resolveInitialToken("", null)).toEqual({ token: "", fromUrl: false });
  });

  it("treats an empty token param as absent", () => {
    expect(resolveInitialToken("?token=", "stored")).toEqual({ token: "stored", fromUrl: false });
  });
});
