import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DecodedImage } from "./imageUpload.js";
import { extForType, pastedImageDir } from "@/lib/pastedImagePath";

// Write validated images into the session's per-session paste dir and return their
// absolute paths for injection into the prompt. A `.mojito/.gitignore` (`*`) keeps
// the files out of the repo's git status without touching the root .gitignore.
export function storePastedImages(
  cwd: string,
  sessionId: string,
  files: DecodedImage[],
): { paths: string[] } {
  const mojitoDir = join(cwd, ".mojito");
  mkdirSync(mojitoDir, { recursive: true });
  const gitignore = join(mojitoDir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");

  const dir = pastedImageDir(cwd, sessionId);
  mkdirSync(dir, { recursive: true });

  const paths: string[] = [];
  for (const f of files) {
    const ext = extForType(f.contentType);
    if (!ext) continue; // validateImages already gated on allowed types; defensive
    const p = join(dir, `${randomUUID()}${ext}`);
    writeFileSync(p, f.bytes);
    paths.push(p);
  }
  return { paths };
}

// Remove a session's paste dir on teardown. Best-effort (force: true → no throw if
// the dir never existed).
export function cleanupPastedImages(cwd: string, sessionId: string): void {
  rmSync(pastedImageDir(cwd, sessionId), { recursive: true, force: true });
}
