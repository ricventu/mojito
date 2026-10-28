import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, linearImageFetcher, validateImages } from "../../src/tasks/images";

const png = (name = "a.png", size = 100) => ({ name, type: "image/png", size });

describe("validateImages", () => {
  it("accepts no images at all", () => {
    expect(validateImages([])).toEqual({ ok: true });
  });

  it("accepts the four image types up to the limit", () => {
    const files = [png(), { name: "b.jpg", type: "image/jpeg", size: 1 }, { name: "c.gif", type: "image/gif", size: 1 }, { name: "d.webp", type: "image/webp", size: MAX_IMAGE_BYTES }];
    expect(validateImages(files)).toEqual({ ok: true });
  });

  it("refuses eleven images", () => {
    const files = Array.from({ length: 11 }, (_, i) => png(`${i}.png`));
    expect(validateImages(files)).toEqual({ ok: false, error: "troppe immagini (max 10)" });
  });

  it("refuses a PDF", () => {
    expect(validateImages([png(), { name: "doc.pdf", type: "application/pdf", size: 10 }])).toEqual({
      ok: false,
      error: "tipo non supportato: application/pdf",
    });
  });

  it("refuses an image one byte over 10 MB", () => {
    expect(validateImages([png("big.png", 10 * 1024 * 1024 + 1)])).toEqual({ ok: false, error: "immagine troppo grande: big.png" });
  });
});

describe("linearImageFetcher", () => {
  it("downloads with the API key and answers base64 plus the bare media type", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png; charset=binary" } }));
    const fetchImage = linearImageFetcher("lin_key", fetchImpl as unknown as typeof fetch);
    expect(await fetchImage("https://uploads.linear.app/x")).toEqual({ mediaType: "image/png", base64: "AQID" });
    expect(fetchImpl).toHaveBeenCalledWith("https://uploads.linear.app/x", {
      headers: { Authorization: "lin_key" },
      signal: expect.any(AbortSignal),
    });
  });

  it("throws on a failed download", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(linearImageFetcher("k", fetchImpl as unknown as typeof fetch)("https://u")).rejects.toThrow("403");
  });
});
