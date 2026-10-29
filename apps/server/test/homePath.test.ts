import { describe, expect, it } from "vitest";
import { expandHome } from "../src/homePath";

describe("expandHome", () => {
  it("expands a leading tilde to the home directory", () => {
    expect(expandHome("~", "/home/me")).toBe("/home/me");
    expect(expandHome("~/", "/home/me")).toBe("/home/me/");
    expect(expandHome("~/code/x", "/home/me")).toBe("/home/me/code/x");
  });

  it("leaves every other path as it is", () => {
    for (const path of ["/repo/web", "repo/web", "./rel", "~bob/code", "/a/~/b"]) {
      expect(expandHome(path, "/home/me")).toBe(path);
    }
  });
});
