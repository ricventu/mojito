import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storePastedImages, cleanupPastedImages } from "@/server/pasteImageStore";
import type { DecodedImage } from "@/server/imageUpload";

function img(type: string, byte: number): DecodedImage {
  const bytes = Buffer.from([byte]);
  return { filename: "x", contentType: type, size: bytes.length, bytes };
}

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "mojito-paste-")); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe("storePastedImages", () => {
  it("writes files with the right extension under the per-session dir and returns absolute paths", () => {
    const { paths } = storePastedImages(cwd, "sess-1", [img("image/png", 1), img("image/webp", 2)]);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(new RegExp(`^${cwd}/\\.mojito/pasted/sess-1/[^/]+\\.png$`));
    expect(paths[1].endsWith(".webp")).toBe(true);
    expect(existsSync(paths[0])).toBe(true);
    expect(readFileSync(paths[0])).toEqual(Buffer.from([1]));
  });

  it("creates .mojito/.gitignore with '*'", () => {
    storePastedImages(cwd, "sess-1", [img("image/png", 1)]);
    expect(readFileSync(join(cwd, ".mojito", ".gitignore"), "utf8")).toBe("*\n");
  });

  it("cleanup removes only that session's dir", () => {
    storePastedImages(cwd, "sess-1", [img("image/png", 1)]);
    storePastedImages(cwd, "sess-2", [img("image/png", 1)]);
    cleanupPastedImages(cwd, "sess-1");
    expect(existsSync(join(cwd, ".mojito", "pasted", "sess-1"))).toBe(false);
    expect(existsSync(join(cwd, ".mojito", "pasted", "sess-2"))).toBe(true);
  });

  it("cleanup is a no-op when the dir does not exist", () => {
    expect(() => cleanupPastedImages(cwd, "never")).not.toThrow();
  });
});
