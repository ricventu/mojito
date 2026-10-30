import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { IMAGE_VIEW_MAX_BYTES, isImagePath } from "@mojito/shared";
import { expandHome } from "../homePath";
import type { ImageType } from "../tasks/images";

export type ImageFileResult =
  | { ok: true; type: ImageType; bytes: Buffer }
  | { ok: false; reason: "not-found" | "too-large" | "not-image" };

/** The type an image's first bytes declare, or null: the name is never trusted for it. */
export function sniffImage(bytes: Buffer): ImageType | null {
  const ascii = (from: number, to: number) => bytes.subarray(from, to).toString("latin1");
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * The absolute file a terminal's image path names, or null when it is no image path. A relative
 * one is read from the session's directory, `~/` from home; an absolute one anywhere — whoever
 * holds the token already has a shell in every session, so a fence here would protect nothing
 * and would miss claude's own scratchpad. What keeps this a viewer is `readImageFile`: only a
 * regular file whose bytes are an image is ever served.
 */
export function resolveImagePath(path: string, cwd: string, home: string): string | null {
  if (!isImagePath(path)) return null;
  return resolve(cwd, expandHome(path, home));
}

/** An image's bytes and the type they show; a missing path or anything but a regular file is not found. */
export function readImageFile(abs: string, maxBytes = IMAGE_VIEW_MAX_BYTES): ImageFileResult {
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { ok: false, reason: "not-found" };
    if (st.size > maxBytes) return { ok: false, reason: "too-large" };
    const bytes = readFileSync(abs);
    const type = sniffImage(bytes);
    return type ? { ok: true, type, bytes } : { ok: false, reason: "not-image" };
  } catch {
    return { ok: false, reason: "not-found" };
  }
}
