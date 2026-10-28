import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImages } from "@/lib/images";

const img = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "a.png",
  type: "image/png",
  size: 1000,
  ...over,
});

describe("validateImages", () => {
  it("accepts an empty set and the four image types", () => {
    expect(validateImages([])).toEqual({ ok: true });
    const all = ["image/png", "image/jpeg", "image/gif", "image/webp"].map((type) => img({ type }));
    expect(validateImages(all)).toEqual({ ok: true });
  });

  it("accepts ten images and refuses eleven", () => {
    expect(validateImages(Array.from({ length: 10 }, () => img()))).toEqual({ ok: true });
    expect(validateImages(Array.from({ length: 11 }, () => img()))).toEqual({
      ok: false,
      error: "troppe immagini (max 10)",
    });
  });

  it("refuses a type outside the four", () => {
    expect(validateImages([img({ type: "application/pdf" })])).toEqual({
      ok: false,
      error: "tipo non supportato: application/pdf",
    });
  });

  it("accepts exactly 10 MB and refuses one byte more", () => {
    expect(validateImages([img({ size: MAX_IMAGE_BYTES })])).toEqual({ ok: true });
    expect(validateImages([img({ name: "big.png", size: MAX_IMAGE_BYTES + 1 })])).toEqual({
      ok: false,
      error: "immagine troppo grande: big.png",
    });
  });
});
