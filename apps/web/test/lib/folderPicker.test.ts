import { describe, expect, it } from "vitest";
import { childPath, dirsHref, tildePath } from "../../src/lib/folderPicker";

describe("tildePath", () => {
  it("writes HOME and what is under it with ~", () => {
    expect(tildePath("/home/me", "/home/me")).toBe("~");
    expect(tildePath("/home/me/code/x", "/home/me")).toBe("~/code/x");
  });

  it("leaves a sibling of HOME and anything else alone", () => {
    expect(tildePath("/home/meow", "/home/me")).toBe("/home/meow");
    expect(tildePath("/srv/x", "/home/me")).toBe("/srv/x");
  });
});

describe("childPath", () => {
  it("joins without a double slash at the root", () => {
    expect(childPath("/", "etc")).toBe("/etc");
    expect(childPath("/home/me", "a b")).toBe("/home/me/a b");
  });
});

describe("dirsHref", () => {
  it("asks for HOME with no path", () => {
    expect(dirsHref(null)).toBe("/api/fs/dirs");
    expect(dirsHref("  ")).toBe("/api/fs/dirs");
  });

  it("encodes the path, trimmed", () => {
    expect(dirsHref("~/a b#?%é")).toBe(`/api/fs/dirs?path=${encodeURIComponent("~/a b#?%é")}`);
    expect(dirsHref(" ~/x ")).toBe("/api/fs/dirs?path=~%2Fx");
  });
});
