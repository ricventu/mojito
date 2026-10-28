import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  TOKEN_KEY, clearToken, getToken, loadStoredToken, resolveInitialToken, setToken, subscribeToken,
} from "@/lib/token";

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

describe("token store", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    clearToken();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("persists under mojito2-token and reads it back", () => {
    setToken("abc");
    expect(getToken()).toBe("abc");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("abc");
    expect(TOKEN_KEY).toBe("mojito2-token");
  });

  it("clearToken forgets it everywhere and notifies subscribers", () => {
    setToken("abc");
    const listener = vi.fn();
    const off = subscribeToken(listener);
    clearToken();
    expect(getToken()).toBe("");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    setToken("x");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps working in memory when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(() => setToken("abc")).not.toThrow();
    expect(getToken()).toBe("abc");
    expect(() => clearToken()).not.toThrow();
  });

  it("loadStoredToken adopts the stored value into memory", () => {
    localStorage.setItem(TOKEN_KEY, "kept");
    expect(loadStoredToken()).toBe("kept");
    expect(getToken()).toBe("kept");
  });
});
