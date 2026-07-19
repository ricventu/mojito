import { join } from "node:path";

const EXT_BY_TYPE = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
]);

// File extension Claude Code needs to recognize a file as an image, derived from its
// content type. Returns null for a type Claude Code cannot read.
export function extForType(type: string): string | null {
  return EXT_BY_TYPE.get(type) ?? null;
}

// Per-session storage dir inside the session's working tree. Claude Code always has
// read access to its cwd, so an injected path here needs no permission prompt. The
// per-session segment keeps two sessions sharing one repo from colliding or cleaning
// up each other's files.
export function pastedImageDir(cwd: string, sessionId: string): string {
  return join(cwd, ".mojito", "pasted", sessionId);
}
