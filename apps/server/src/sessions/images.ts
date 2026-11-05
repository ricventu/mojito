import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_IMAGES, MAX_IMAGE_BYTES, isImageType, type ImageType } from "../tasks/images";

const EXTENSIONS: Record<ImageType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * Where a session's attachments live: the state dir, never the project. claude turns a pasted
 * absolute image path into an attachment wherever the file is, without a permission prompt
 * (verified on Claude Code 2.1.312). A PDF's path stays text it has to read, which outside the
 * project does prompt — `buildHookSettings` allows reads of this folder (verified on 2.1.318).
 */
export const imagesDir = (stateDir: string, sessionId: string): string => join(stateDir, "images", sessionId);

/** `File.type` alone is not enough: a browser may hand a document over with none. */
const isPdf = (f: { name: string; type: string }): boolean => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/**
 * What a session accepts, checked as a whole before anything is written. Separate from
 * `validateImages`, which guards what reaches Linear. Same limits and messages as the client
 * (`apps/web/src/lib/terminal/attachments.ts`).
 */
export function validateAttachments(files: { name: string; type: string; size: number }[]): { ok: true } | { ok: false; error: string } {
  if (files.length > MAX_IMAGES) return { ok: false, error: `too many files (max ${MAX_IMAGES})` };
  for (const f of files) {
    if (!isImageType(f.type) && !isPdf(f)) return { ok: false, error: `unsupported file: ${f.name} (images and PDF only)` };
    if (f.size > MAX_IMAGE_BYTES) return { ok: false, error: `file too large: ${f.name}` };
  }
  return { ok: true };
}

/** A PDF's name, for claude to read: pasted paths are space-separated, so only plain characters stay. */
function safeStem(name: string): string {
  const stem = name
    .replace(/\.pdf$/i, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return stem || "document";
}

/**
 * Writes the files into `dir`, readable by the user only; their absolute paths in order. The
 * name never decides the extension: an image is named after its type and a PDF is `.pdf`.
 */
export function storeAttachments(dir: string, files: { name: string; type: string; bytes: Uint8Array }[]): string[] {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return files.map(({ name, type, bytes }) => {
    const hex = randomBytes(6).toString("hex");
    const path = join(dir, isImageType(type) ? `${hex}${EXTENSIONS[type]}` : `${safeStem(name)}-${hex}.pdf`);
    writeFileSync(path, bytes, { mode: 0o600 });
    return path;
  });
}
