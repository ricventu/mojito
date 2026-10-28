import { describe, expect, it } from "vitest";
import { CHUNK_RELOAD_KEY, chunkErrorAction, chunkLoaded, isChunkLoadError } from "@/lib/chunkReload";

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const chromium = new TypeError("Failed to fetch dynamically imported module: http://h/assets/TerminalPage-abc.js");

describe("isChunkLoadError", () => {
  it.each([
    chromium,
    new TypeError("error loading dynamically imported module: http://h/assets/x.js"),
    new TypeError("Importing a module script failed."),
    new Error("Unable to preload CSS for /assets/x.css"),
  ])("recognises %s", (err) => {
    expect(isChunkLoadError(err)).toBe(true);
  });

  it("leaves every other error alone", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("chunkErrorAction", () => {
  it("reloads once on a chunk failure, setting the guard", () => {
    const s = memory();
    expect(chunkErrorAction(chromium, s)).toBe("reload");
    expect(s.m.get(CHUNK_RELOAD_KEY)).toBe("1");
  });

  // The chunk is still missing after a fresh load: a real failure, not a stale client.
  it("shows the second failure in a row instead of looping, and clears the guard", () => {
    const s = memory();
    chunkErrorAction(chromium, s);
    expect(chunkErrorAction(chromium, s)).toBe("show");
    expect(s.m.has(CHUNK_RELOAD_KEY)).toBe(false);
  });

  it("reloads again after the chunk has loaded once in between (a later deploy)", () => {
    const s = memory();
    chunkErrorAction(chromium, s);
    chunkLoaded(s);
    expect(chunkErrorAction(chromium, s)).toBe("reload");
  });

  it("shows any other error without touching storage", () => {
    const s = memory();
    expect(chunkErrorAction(new Error("boom"), s)).toBe("show");
    expect(s.m.size).toBe(0);
  });

  it("shows when storage is missing or throws, since a loop could not be told apart", () => {
    expect(chunkErrorAction(chromium, null)).toBe("show");
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(chunkErrorAction(chromium, broken)).toBe("show");
  });
});
