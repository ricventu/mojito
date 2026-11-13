import { lstat, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DirEntry, DirList } from "@mojito/shared";

export type DirListResult = { ok: true; list: DirList } | { ok: false; reason: "not-found" | "forbidden" };

const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code;

/** A child that is a folder, or a symlink to one; anything that fails to stat is no folder. */
async function isDir(path: string, entry: { isDirectory(): boolean; isSymbolicLink(): boolean }): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/**
 * HOME's children macOS privacy controls guard: touching anything inside one (even an `lstat` of
 * `.git`) from the LaunchAgent's node can put a permission prompt on the Mac's screen, and a
 * "Don't Allow" sticks to that process and the sessions it spawns. They are never repos.
 */
const MAC_GUARDED = new Set(["Desktop", "Documents", "Downloads"]);

/**
 * The subfolders of `path` (absolute, normalised), for the project folder picker. Hidden ones
 * (a leading `.`) are left out; a child that cannot be read is skipped, never fails the list.
 * A missing path or a file is `not-found`, an unreadable folder `forbidden`; any other error
 * is the server's (rethrown, a 500).
 */
export async function listDirs(
  path: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): Promise<DirListResult> {
  const guarded = platform === "darwin" && path === home;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (e) {
    const c = code(e);
    if (c === "ENOENT" || c === "ENOTDIR") return { ok: false, reason: "not-found" };
    if (c === "EACCES" || c === "EPERM") return { ok: false, reason: "forbidden" };
    throw e;
  }
  const found = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith("."))
      .map(async (e): Promise<DirEntry | null> => {
        const child = join(path, e.name);
        if (!(await isDir(child, e))) return null;
        if (guarded && MAC_GUARDED.has(e.name)) return { name: e.name, git: false };
        const git = await lstat(join(child, ".git")).then(
          () => true,
          () => false,
        );
        return { name: e.name, git };
      }),
  );
  const dirs = found
    .filter((d): d is DirEntry => d !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const parent = dirname(path);
  return { ok: true, list: { path, parent: parent === path ? null : parent, home, dirs } };
}
