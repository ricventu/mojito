import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { detectDefaultBranch } from "./reviewScale.js";

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

export interface DocEntry {
  path: string;   // relative to the worktree root, "/" separated
  name: string;   // basename
  source: "specs" | "plans" | "branch";
  mtime: string;  // ISO
  size: number;   // bytes
}

const SKIP_DIRS = new Set(["node_modules"]);
const MAX_DEPTH = 6;

// A directory holding a `.git` entry is another checkout: a linked worktree (where
// `.git` is a file) or a clone (where it is a directory). Its documents belong to
// that tree, not to the one being listed.
function isNestedCheckout(abs: string): boolean {
  return existsSync(join(abs, ".git"));
}

// null when the path is gone or unreadable: `git diff --name-only` reports files
// the branch deleted, and those must not reach the list as dead rows.
export function docEntry(root: string, rel: string, source: DocEntry["source"]): DocEntry | null {
  try {
    const st = statSync(join(root, rel));
    if (!st.isFile()) return null;
    return { path: rel, name: basename(rel), source, mtime: st.mtime.toISOString(), size: st.size };
  } catch {
    return null;
  }
}

function mdFilesIn(root: string, relDir: string, source: DocEntry["source"]): DocEntry[] {
  let names: string[];
  try {
    names = readdirSync(join(root, relDir));
  } catch {
    return []; // that folder simply does not exist in this worktree
  }
  const out: DocEntry[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const entry = docEntry(root, `${relDir}/${name}`, source);
    if (entry) out.push(entry);
  }
  return out;
}

// Walks for `docs/superpowers/{specs,plans}` at any depth up to MAX_DEPTH, so a
// monorepo's web/docs/superpowers/specs is found as well as a root-level one.
export function scanSuperpowersDocs(root: string): DocEntry[] {
  const out: DocEntry[] = [];
  const walk = (relDir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(relDir ? join(root, relDir) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      const childRel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.name === "superpowers" && basename(relDir) === "docs") {
        out.push(...mdFilesIn(root, `${childRel}/specs`, "specs"));
        out.push(...mdFilesIn(root, `${childRel}/plans`, "plans"));
        continue; // nothing deeper under superpowers is listed
      }
      if (depth < MAX_DEPTH && !isNestedCheckout(join(root, childRel))) walk(childRel, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export type Run = (cmd: string, args: string[]) => string;

// Markdown the branch created or modified vs the default branch's merge base.
// Best-effort by design: no git, no default branch, no commits yet, or any git
// error yields an empty list so the superpowers scan still shows on its own.
export function branchMdPaths(
  root: string,
  run: Run = (cmd, args) =>
    execFileSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      // Keep git's own stderr (e.g. "fatal: not a git repository" for a plain
      // worktree) out of the service journal, and never let a wedged git call
      // block Mojito's single-threaded server — which also serves the terminal
      // WebSockets — indefinitely.
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }),
): string[] {
  const base = detectDefaultBranch(run);
  if (!base) return [];
  try {
    // core.quotePath=false stops git from octal-escaping non-ASCII filenames
    // (e.g. "spec-perché.md" -> "spec-perch\303\251.md"), which docEntry would
    // otherwise stat verbatim and silently drop. --relative reports paths
    // relative to cwd rather than the working-tree root, which matters when
    // `root` is a subdirectory of the repository.
    return run("git", ["-c", "core.quotePath=false", "diff", "--name-only", "--relative", `${base}...HEAD`, "--", "*.md"])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The listing behind GET /api/docs: superpowers specs/plans plus any markdown the
// branch touched, deduplicated by relative path (the folder wins over the git
// origin) and sorted newest first.
export function listDocs(root: string, run?: Run): DocEntry[] {
  const docs = scanSuperpowersDocs(root);
  const seen = new Set(docs.map((d) => d.path));
  for (const rel of branchMdPaths(root, run)) {
    if (seen.has(rel)) continue;
    const entry = docEntry(root, rel, "branch");
    if (!entry) continue;
    seen.add(rel);
    docs.push(entry);
  }
  return docs.sort((a, b) =>
    a.mtime === b.mtime ? a.path.localeCompare(b.path) : a.mtime < b.mtime ? 1 : -1,
  );
}
