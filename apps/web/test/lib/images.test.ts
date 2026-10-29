import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, dragHasFiles, droppedImages, pastedImages, validateImages } from "@/lib/images";

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
      error: "too many images (max 10)",
    });
  });

  it("refuses a type outside the four", () => {
    expect(validateImages([img({ type: "application/pdf" })])).toEqual({
      ok: false,
      error: "unsupported type: application/pdf",
    });
  });

  it("accepts exactly 10 MB and refuses one byte more", () => {
    expect(validateImages([img({ size: MAX_IMAGE_BYTES })])).toEqual({ ok: true });
    expect(validateImages([img({ name: "big.png", size: MAX_IMAGE_BYTES + 1 })])).toEqual({
      ok: false,
      error: "image too large: big.png",
    });
  });
});

const file = (name: string, type: string, size = 3) => new File([new Uint8Array(size)], name, { type });

function clipboard(files: File[], text = "") {
  return { files, getData: (type: string) => (type === "text/plain" ? text : "") };
}

describe("pastedImages", () => {
  it("takes the images of a paste that carries no text", () => {
    const shot = file("image.png", "image/png");
    expect(pastedImages(clipboard([shot]))).toEqual([shot]);
  });

  it("leaves a paste with text to the text, even with an image beside it", () => {
    // A spreadsheet copy carries its cells as text and a picture of them as an image; a Word
    // paragraph, its words and a rendering of them.
    expect(pastedImages(clipboard([file("cells.png", "image/png")], "a\tb"))).toEqual([]);
    expect(pastedImages(clipboard([file("image.png", "image/png")], "A paragraph from Word"))).toEqual([]);
  });

  it("takes an unsupported image too, so the refusal says why", () => {
    const heic = file("photo.heic", "image/heic");
    expect(pastedImages(clipboard([heic]))).toEqual([heic]);
  });

  it("ignores files that are not images", () => {
    expect(pastedImages(clipboard([file("notes.pdf", "application/pdf")]))).toEqual([]);
  });
});

describe("droppedImages", () => {
  it("takes the images of a drop, in order", () => {
    const a = file("a.png", "image/png");
    const b = file("b.jpg", "image/jpeg");
    expect(droppedImages({ files: [a, file("x.txt", "text/plain"), b] })).toEqual([a, b]);
  });
});

describe("dragHasFiles", () => {
  it("is true for a drag of files and false for a drag of text or nothing", () => {
    expect(dragHasFiles(["Files"])).toBe(true);
    expect(dragHasFiles(["text/plain", "Files"])).toBe(true);
    expect(dragHasFiles(["text/plain", "text/html"])).toBe(false);
    expect(dragHasFiles([])).toBe(false);
    expect(dragHasFiles(undefined)).toBe(false);
  });
});
