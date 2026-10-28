import { describe, it, expect } from "vitest";
import { THEME_KEY, applyTheme, readTheme, writeTheme } from "@/lib/theme";

const store = (value: string | null) => ({ getItem: (k: string) => (k === THEME_KEY ? value : null) });

describe("readTheme", () => {
  it("reads a stored preference", () => {
    expect(readTheme(store("light"))).toBe("light");
    expect(readTheme(store("dark"))).toBe("dark");
  });

  it("falls back to dark for nothing, junk, a throwing store or no store", () => {
    expect(readTheme(store(null))).toBe("dark");
    expect(readTheme(store("purple"))).toBe("dark");
    expect(
      readTheme({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("dark");
    expect(readTheme(undefined)).toBe("dark");
  });
});

describe("writeTheme", () => {
  it("stores under the mojito2 key", () => {
    const seen: [string, string][] = [];
    writeTheme("light", { setItem: (k, v) => void seen.push([k, v]) });
    expect(seen).toEqual([["mojito2-theme", "light"]]);
  });

  it("swallows a throwing store", () => {
    expect(() =>
      writeTheme("light", {
        setItem: () => {
          throw new Error("private mode");
        },
      }),
    ).not.toThrow();
  });
});

describe("applyTheme", () => {
  it("toggles the dark class", () => {
    const classes = new Set<string>(["dark"]);
    const root = {
      classList: {
        toggle: (c: string, force?: boolean) => {
          if (force) classes.add(c);
          else classes.delete(c);
          return !!force;
        },
      },
    } as unknown as HTMLElement;
    applyTheme("light", root);
    expect(classes.has("dark")).toBe(false);
    applyTheme("dark", root);
    expect(classes.has("dark")).toBe(true);
  });
});
