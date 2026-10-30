import { isValidHash, type CommitDetails, type CommitDiff, type CommitFile } from "@mojito/shared";
import { GitError, type GitRun } from "./git";

// One commit's details and one file's diff, read-only. The hash is checked and resolved before
// anything else runs, and every path goes to git as a literal pathspec: both come from a query.

/** Files listed per commit; the rest are only counted. */
export const MAX_FILES = 300;

/** A diff is cut at the last full line within this many characters (256 KB). */
export const MAX_PATCH = 262_144;

/** `--name-status -z`: status, path, and for a rename or copy (`R087`, `C100`) the old path then the new. */
export function parseNameStatus(out: string): CommitFile[] {
  const tokens = out.split("\0");
  const files: CommitFile[] = [];
  for (let i = 0; i < tokens.length && tokens[i] !== ""; ) {
    const status = tokens[i]![0]!;
    if (status === "R" || status === "C") {
      files.push({ status, from: tokens[i + 1] ?? "", path: tokens[i + 2] ?? "" });
      i += 3;
    } else {
      files.push({ status, path: tokens[i + 1] ?? "" });
      i += 2;
    }
  }
  return files;
}

/** The hunks only: git's own header says nothing the file list does not. */
export function parsePatch(out: string, limit = MAX_PATCH): CommitDiff {
  const hunks = out.search(/^@@/m);
  if (hunks < 0) return { patch: "", binary: /^Binary files /m.test(out), truncated: false };
  const patch = out.slice(hunks);
  if (patch.length <= limit) return { patch, binary: false, truncated: false };
  return { patch: patch.slice(0, patch.slice(0, limit).lastIndexOf("\n") + 1), binary: false, truncated: true };
}

/**
 * The full hash `hash` names, or null when no commit does: `--verify -q` exits 1 for an unknown
 * hash. Any other failure (128 outside a repo, a timeout) is not "not found" and propagates.
 */
async function resolve(cwd: string, hash: string, run: GitRun): Promise<string | null> {
  if (!isValidHash(hash)) throw new Error("invalid hash");
  try {
    return (await run(["rev-parse", "--verify", "-q", "--end-of-options", `${hash}^{commit}`], cwd)).trim() || null;
  } catch (err) {
    if (err instanceof GitError && err.exitCode === 1) return null;
    throw err;
  }
}

export async function readCommit(cwd: string, hash: string, run: GitRun): Promise<CommitDetails | null> {
  const full = await resolve(cwd, hash, run);
  if (!full) return null;
  const [info, names] = await Promise.all([
    run(["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%B", full], cwd),
    run(["show", "--format=", "--name-status", "-z", "-M", "--diff-merges=first-parent", full], cwd),
  ]);
  const [hashOut = full, parents = "", author = "", email = "", date = "", ...body] = info.split("\x00");
  const files = parseNameStatus(names);
  return {
    hash: hashOut,
    parents: parents.split(" ").filter(Boolean),
    author,
    email,
    date,
    message: body.join("\x00").trim(),
    files: files.slice(0, MAX_FILES),
    moreFiles: Math.max(0, files.length - MAX_FILES),
  };
}

/** `from` is a rename's old path: giving both keeps the diff a rename instead of a delete and an add. */
export async function readDiff(cwd: string, hash: string, path: string, from: string | null, run: GitRun): Promise<CommitDiff | null> {
  const full = await resolve(cwd, hash, run);
  if (!full) return null;
  const paths = [path, ...(from ? [from] : [])].map((p) => `:(literal)${p}`);
  const out = await run(["show", "--format=", "--patch", "-M", "--no-color", "--no-ext-diff", "--diff-merges=first-parent", full, "--", ...paths], cwd);
  return parsePatch(out);
}
