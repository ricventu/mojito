import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

// Read-only markdown discovery for a worktree. Nothing in this module writes.

export const DOC_MAX_BYTES = 512 * 1024;

export type ReadDocResult =
  | { ok: true; content: string }
  | { ok: false; reason: "not-found" | "too-large" };

function inside(root: string, target: string): boolean {
  // Compare with the separator appended: without it, a sibling directory whose
  // name merely starts with the root's name (…/repo-old vs …/repo) would pass.
  const base = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(base);
}

// The security boundary for the content route: a caller-supplied relative path
// becomes an absolute path only if it stays inside `root` and names a .md file.
// null means "reject with 400" — never "not found".
export function resolveDocPath(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || isAbsolute(rel)) return null;
  if (rel.split(/[\\/]/).includes("..")) return null;
  if (!rel.toLowerCase().endsWith(".md")) return null;
  const abs = resolve(root, rel);
  if (!inside(root, abs)) return null;
  try {
    // Symlinks are only checkable once the target exists. A missing file falls
    // through to the catch and is reported as not-found by readDoc instead.
    const real = realpathSync(abs);
    return inside(realpathSync(root), real) ? real : null;
  } catch {
    return abs;
  }
}

export function readDoc(abs: string, maxBytes = DOC_MAX_BYTES): ReadDocResult {
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!st.isFile()) return { ok: false, reason: "not-found" };
  if (st.size > maxBytes) return { ok: false, reason: "too-large" };
  return { ok: true, content: readFileSync(abs, "utf8") };
}
