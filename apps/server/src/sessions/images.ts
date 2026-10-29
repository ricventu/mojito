import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageType } from "../tasks/images";

const EXTENSIONS: Record<ImageType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * Where a session's pasted images live: the state dir, never the project. claude turns a
 * pasted absolute image path into an attachment wherever the file is, without a permission
 * prompt, so nothing has to land in the repo (verified on Claude Code 2.1.312).
 */
export const imagesDir = (stateDir: string, sessionId: string): string => join(stateDir, "images", sessionId);

/** Writes the images into `dir` under random names, readable by the user only; their absolute paths in order. */
export function storeImages(dir: string, images: { type: ImageType; bytes: Uint8Array }[]): string[] {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return images.map(({ type, bytes }) => {
    const path = join(dir, `${randomBytes(6).toString("hex")}${EXTENSIONS[type]}`);
    writeFileSync(path, bytes, { mode: 0o600 });
    return path;
  });
}
