import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readImageFile, resolveImagePath, sniffImage } from "../../src/sessions/viewImage";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const GIF = [...Buffer.from("GIF89a"), 1, 0];
const WEBP = [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBPVP8 ")];

describe("sniffImage", () => {
  it("names the type from the magic bytes", () => {
    expect(sniffImage(Buffer.from(PNG))).toBe("image/png");
    expect(sniffImage(Buffer.from(JPEG))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from(GIF))).toBe("image/gif");
    expect(sniffImage(Buffer.from(WEBP))).toBe("image/webp");
  });

  it("knows nothing else, whatever the file is called", () => {
    expect(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(Buffer.from("MOJITO_TOKEN=secret"))).toBeNull();
    expect(sniffImage(Buffer.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")]))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("resolveImagePath", () => {
  it("reads a relative path from the session's directory and ~/ from home", () => {
    expect(resolveImagePath("shots/a.png", "/repo/web", "/home/me")).toBe("/repo/web/shots/a.png");
    expect(resolveImagePath("./a.png", "/repo/web", "/home/me")).toBe("/repo/web/a.png");
    expect(resolveImagePath("~/p/a.jpg", "/repo/web", "/home/me")).toBe("/home/me/p/a.jpg");
  });

  it("takes an absolute path anywhere: the token already opens a shell", () => {
    expect(resolveImagePath("/tmp/claude-1000/x/scratchpad/a.png", "/repo/web", "/home/me")).toBe(
      "/tmp/claude-1000/x/scratchpad/a.png",
    );
  });

  it("refuses what is not an image path", () => {
    for (const bad of ["", "a.svg", ".env", "../a.png", "/repo/../a.png", "a\0.png"]) {
      expect(resolveImagePath(bad, "/repo/web", "/home/me"), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("readImageFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "mj-view-image-"));
  const file = (name: string, bytes: number[] | Buffer) => {
    const path = join(dir, name);
    writeFileSync(path, Buffer.from(bytes));
    return path;
  };

  it("answers the bytes and the type they show", () => {
    const read = readImageFile(file("a.png", PNG));
    expect(read).toEqual({ ok: true, type: "image/png", bytes: Buffer.from(PNG) });
  });

  it("goes by the bytes, not the name", () => {
    expect(readImageFile(file("really-a-jpeg.png", JPEG))).toMatchObject({ ok: true, type: "image/jpeg" });
    expect(readImageFile(file("secrets.png", Buffer.from("MOJITO_TOKEN=x")))).toEqual({ ok: false, reason: "not-image" });
  });

  it("follows a symlink but still asks the target's bytes", () => {
    const target = file(".env", Buffer.from("MOJITO_TOKEN=x"));
    const link = join(dir, "link.png");
    symlinkSync(target, link);
    expect(readImageFile(link)).toEqual({ ok: false, reason: "not-image" });
  });

  it("is not found for a missing path or anything but a regular file", () => {
    expect(readImageFile(join(dir, "missing.png"))).toEqual({ ok: false, reason: "not-found" });
    const sub = join(dir, "folder.png");
    mkdirSync(sub);
    expect(readImageFile(sub)).toEqual({ ok: false, reason: "not-found" });
  });

  it("is too large past the cap, before reading it", () => {
    expect(readImageFile(file("big.png", [...PNG, 0, 0, 0, 0]), PNG.length)).toEqual({ ok: false, reason: "too-large" });
  });
});
