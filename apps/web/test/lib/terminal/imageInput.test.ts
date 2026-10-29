import { describe, expect, it, vi } from "vitest";
import { attachImages, droppedImages, pastedImages } from "@/lib/terminal/imageInput";

const file = (name: string, type: string, size = 3) => new File([new Uint8Array(size)], name, { type });

function clipboard(files: File[], text = "") {
  return { files, getData: (type: string) => (type === "text/plain" ? text : "") };
}

describe("pastedImages", () => {
  it("takes the images of a paste that carries no text", () => {
    const shot = file("image.png", "image/png");
    expect(pastedImages(clipboard([shot]))).toEqual([shot]);
  });

  it("leaves a paste with text to xterm, even with an image beside it", () => {
    // A spreadsheet copy carries its cells as text and a picture of them as an image.
    expect(pastedImages(clipboard([file("cells.png", "image/png")], "a\tb"))).toEqual([]);
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

describe("attachImages", () => {
  it("uploads the images and pastes their paths for claude, space-separated with a trailing space", async () => {
    const upload = vi.fn(async (_files: File[]) => ["/s/images/mj-RIC-1/a.png", "/s/images/mj-RIC-1/b.jpg"]);
    const paste = vi.fn();
    const files = [file("a.png", "image/png"), file("b.jpg", "image/jpeg")];
    expect(await attachImages(files, { upload, paste })).toEqual({ ok: true });
    expect(upload).toHaveBeenCalledWith(files);
    expect(paste).toHaveBeenCalledWith("/s/images/mj-RIC-1/a.png /s/images/mj-RIC-1/b.jpg ");
  });

  it("refuses a set the server would refuse, before uploading", async () => {
    const upload = vi.fn(async () => []);
    const paste = vi.fn();
    const result = await attachImages([file("photo.heic", "image/heic")], { upload, paste });
    expect(result).toEqual({ ok: false, error: "unsupported type: image/heic" });
    expect(upload).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });

  it("reports a failed upload and pastes nothing", async () => {
    const paste = vi.fn();
    const upload = vi.fn(async () => {
      throw new Error("session ended: mj-RIC-1");
    });
    const result = await attachImages([file("a.png", "image/png")], { upload, paste });
    expect(result).toEqual({ ok: false, error: "session ended: mj-RIC-1" });
    expect(paste).not.toHaveBeenCalled();
  });
});
