import { describe, expect, it } from "vitest";
import { isImagePath } from "../src/index";

describe("isImagePath", () => {
  it("accepts png, jpeg, gif and webp paths in any case, relative, absolute or under HOME", () => {
    for (const ok of ["shot.png", "a/B.PNG", "/tmp/x/y.jpg", "~/p.jpeg", "./g.gif", "w.WebP", "with space.png", "perché.png"]) {
      expect(isImagePath(ok), ok).toBe(true);
    }
  });

  it("rejects empty, svg and other types, NUL, parent segments and a bare extension", () => {
    for (const bad of ["", "x.svg", "x.heic", "x.png.bak", "a\0b.png", "../x.png", "a/../x.png", ".png", "a/.jpg"]) {
      expect(isImagePath(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
