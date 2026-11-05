import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import { attachFiles, pastedAttachments, validateAttachments } from "@/lib/terminal/attachments";

const file = (name: string, type: string, size = 3) => new File([new Uint8Array(size)], name, { type });
const clipboard = (files: File[], text = "") => ({ files, getData: (t: string) => (t === "text/plain" ? text : "") });

describe("attachFiles", () => {
  it("uploads the files and pastes their paths for claude, space-separated with a trailing space", async () => {
    const upload = vi.fn(async (_files: File[]) => ["/s/images/mj-RIC-1/a.png", "/s/images/mj-RIC-1/spec-1a2b.pdf"]);
    const paste = vi.fn();
    const files = [file("a.png", "image/png"), file("spec.pdf", "application/pdf")];
    expect(await attachFiles(files, { upload, paste })).toEqual({ ok: true });
    expect(upload).toHaveBeenCalledWith(files);
    expect(paste).toHaveBeenCalledWith("/s/images/mj-RIC-1/a.png /s/images/mj-RIC-1/spec-1a2b.pdf ");
  });

  it("refuses a set the server would refuse, before uploading", async () => {
    const upload = vi.fn(async () => []);
    const paste = vi.fn();
    const result = await attachFiles([file("photo.heic", "image/heic")], { upload, paste });
    expect(result).toEqual({ ok: false, error: "unsupported file: photo.heic (images and PDF only)" });
    expect(upload).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });

  it("reports a failed upload, an older peer's refusal included, and pastes nothing", async () => {
    const paste = vi.fn();
    const upload = vi.fn(async () => {
      throw new Error("unsupported type: application/pdf");
    });
    const result = await attachFiles([file("a.pdf", "application/pdf")], { upload, paste });
    expect(result).toEqual({ ok: false, error: "unsupported type: application/pdf" });
    expect(paste).not.toHaveBeenCalled();
  });
});

describe("attachFiles, when the connection drops", () => {
  // fetch's own words, a different phrase in each browser ("Load failed" in Safari), say nothing.
  it("says so in plain words and pastes nothing", async () => {
    const paste = vi.fn();
    const upload = vi.fn(async () => {
      throw new TypeError("Load failed");
    });
    const result = await attachFiles([file("a.pdf", "application/pdf")], { upload, paste });
    expect(result).toEqual({ ok: false, error: "upload failed: the connection dropped" });
    expect(paste).not.toHaveBeenCalled();
  });
});

describe("validateAttachments", () => {
  it("accepts the images and a PDF by type or by extension, whatever its case", () => {
    const set = [
      file("a.png", "image/png"),
      file("b.jpg", "image/jpeg"),
      file("c.gif", "image/gif"),
      file("d.webp", "image/webp"),
      file("e.pdf", "application/pdf"),
      file("F.PDF", ""),
      file("download", "application/pdf"),
    ];
    expect(validateAttachments(set)).toEqual({ ok: true });
  });

  it("refuses anything else, by name", () => {
    for (const f of [file("a.zip", "application/zip"), file("a.xlsx", ""), file("a.pdf.exe", ""), file("folder", "")]) {
      expect(validateAttachments([f])).toEqual({ ok: false, error: `unsupported file: ${f.name} (images and PDF only)` });
    }
  });

  it("caps the set at 10 files and each file at 10 MB", () => {
    const pdf = (size = 3) => file("a.pdf", "application/pdf", size);
    expect(validateAttachments(Array.from({ length: 10 }, () => pdf()))).toEqual({ ok: true });
    expect(validateAttachments(Array.from({ length: 11 }, () => pdf()))).toEqual({ ok: false, error: "too many files (max 10)" });
    const big = { name: "big.pdf", type: "application/pdf", size: MAX_IMAGE_BYTES + 1 };
    expect(validateAttachments([{ ...big, size: MAX_IMAGE_BYTES }])).toEqual({ ok: true });
    expect(validateAttachments([big])).toEqual({ ok: false, error: "file too large: big.pdf" });
  });
});

describe("pastedAttachments", () => {
  const pdf = file("spec.pdf", "application/pdf");

  it("takes every file of a paste without text, so a type the server refuses is refused with a reason", () => {
    const zip = file("a.zip", "application/zip");
    expect(pastedAttachments(clipboard([pdf, zip]))).toEqual([pdf, zip]);
    expect(pastedAttachments(clipboard([]))).toEqual([]);
  });

  it("is a text paste when it carries text: spreadsheet cells keep pasting the cells, whatever comes beside them", () => {
    expect(pastedAttachments(clipboard([file("cells.png", "image/png")], "a\tb"))).toEqual([]);
    expect(pastedAttachments(clipboard([file("image.pdf", "application/pdf")], "a\tb"))).toEqual([]);
  });
});
