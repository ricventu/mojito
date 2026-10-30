import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { DOC_MAX_BYTES, isDocPath } from "@mojito/shared";

export type ReadDocResult = { ok: true; content: string } | { ok: false; reason: "not-found" | "too-large" };

/** With the separator appended: a sibling `…/repo-old` is not inside `…/repo`. */
function inside(root: string, target: string): boolean {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** A directory's realpath, or itself when it cannot be resolved (then nothing real is inside it). */
function real(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * The security boundary of the file route: the absolute file a caller's `path` names, or null
 * (a 400, never a 404 — "not found" would say whether the file exists). A relative path resolves
 * against `root`; an absolute one (`~/` expands to `home`) must lie inside one of `allowed`. The
 * file's realpath is checked again, so a symlink cannot point out; a missing file skips that step
 * and is reported by the read.
 */
export function resolveDocPath(path: string, root: string, allowed: string[], home: string): string | null {
  if (!isDocPath(path)) return null;
  const expanded = path.startsWith("~/") ? join(home, path.slice(2)) : path;
  const roots = isAbsolute(expanded) ? allowed : [root];
  const abs = resolve(root, expanded);
  if (!roots.some((r) => inside(resolve(r), abs))) return null;
  let target: string;
  try {
    target = realpathSync(abs);
  } catch {
    return abs;
  }
  return roots.some((r) => inside(real(r), target)) ? target : null;
}

/** A document's text: a missing path or anything not a regular file is not found; past the cap, too large. */
export function readDoc(abs: string, maxBytes = DOC_MAX_BYTES): ReadDocResult {
  let size: number;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return { ok: false, reason: "not-found" };
    size = st.size;
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (size > maxBytes) return { ok: false, reason: "too-large" };
  return { ok: true, content: readFileSync(abs, "utf8") };
}
