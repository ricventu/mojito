import { describe, it, expect } from "vitest";
import { validateImages } from "@/server/imageUpload";

const png = (b64: string) => `data:image/png;base64,${b64}`;
const tiny = Buffer.from([137, 80, 78, 71]).toString("base64"); // 4 bytes

describe("validateImages", () => {
  it("treats undefined/null as an empty list", () => {
    expect(validateImages(undefined)).toEqual({ ok: true, files: [] });
    expect(validateImages(null)).toEqual({ ok: true, files: [] });
  });

  it("decodes a valid image entry", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: png(tiny) }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.files).toHaveLength(1);
      expect(res.files[0]).toMatchObject({ filename: "a.png", contentType: "image/png", size: 4 });
      expect(res.files[0].bytes).toHaveLength(4);
    }
  });

  it("rejects a non-array", () => {
    expect(validateImages({})).toEqual({ ok: false, error: "images must be an array" });
  });

  it("rejects an unsupported type", () => {
    const res = validateImages([{ name: "a.svg", type: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }]);
    expect(res).toEqual({ ok: false, error: "unsupported image type: image/svg+xml" });
  });

  it("rejects malformed data", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: "not-a-data-url" }]);
    expect(res).toEqual({ ok: false, error: "malformed image data" });
  });

  it("rejects a type/data mismatch", () => {
    const res = validateImages([{ name: "a.png", type: "image/png", dataUrl: `data:image/jpeg;base64,${tiny}` }]);
    expect(res).toEqual({ ok: false, error: "image type mismatch" });
  });

  it("rejects too many images", () => {
    const many = Array.from({ length: 11 }, () => ({ name: "a.png", type: "image/png", dataUrl: png(tiny) }));
    expect(validateImages(many)).toEqual({ ok: false, error: "too many images (max 10)" });
  });

  it("rejects an oversized image", () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    const res = validateImages([{ name: "big.png", type: "image/png", dataUrl: png(big) }]);
    expect(res).toEqual({ ok: false, error: "image too large (max 10485760 bytes)" });
  });
});
