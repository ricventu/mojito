import { statSync } from "node:fs";
import { join } from "node:path";
import type { DocEntry, DocList } from "@mojito/shared";
import type { GitRun } from "../git/git";
import { ticketToken } from "../git/ticketBranch";
import { docRoot } from "./root";

/** Markdown, any case; a pathspec git matches against paths below the cwd. */
const MARKDOWN = ":(icase)*.md";

/** NUL-separated paths (`-z`: never C-quoted, so `spec-perché.md` arrives as itself). */
const paths = (out: string) => out.split("\0").filter(Boolean);

/** A failing read here means "nothing": `git grep` exits 1 when nothing matches. */
const orNone = async (run: GitRun, args: string[], cwd: string): Promise<string[]> => {
  try {
    return paths(await run(args, cwd));
  } catch {
    return [];
  }
};

/**
 * A project's markdown, newest first: what `git ls-files` sees in the root, tracked or not,
 * `.gitignore` respected and nested checkouts left out. Only that listing may throw (`GitError`:
 * not a repo, a timeout). With a ticket, its own documents — the id as a token of the path, the id
 * in the body (`git grep`, fixed string, whole word), or what its branch touched — best-effort.
 */
export async function readDocList(checkout: string, ticket: string | null, run: GitRun): Promise<DocList> {
  const where = await docRoot(checkout, ticket, run);
  const { root } = where;
  const listed = new Set(paths(await run(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", MARKDOWN], root)));
  const docs: DocEntry[] = [];
  for (const path of listed) {
    try {
      const st = statSync(join(root, path));
      // A tracked file deleted from the working tree is still listed by --cached.
      if (st.isFile()) docs.push({ path, mtime: st.mtime.toISOString(), size: st.size });
    } catch {
      // Gone between the listing and the stat.
    }
  }
  docs.sort((a, b) => (a.mtime === b.mtime ? (a.path < b.path ? -1 : 1) : a.mtime < b.mtime ? 1 : -1));
  if (!ticket) return { docs, ticketDocs: [] };

  const token = ticketToken(ticket);
  const [mentioned, touched] = await Promise.all([
    orNone(run, ["grep", "-l", "-z", "-I", "-i", "-w", "-F", "--untracked", "-e", ticket, "--", MARKDOWN], root),
    where.branch && where.base
      ? orNone(run, ["diff", "--name-only", "-z", "--relative", `${where.base.hash}...${where.branch.hash}`, "--", MARKDOWN], root)
      : Promise.resolve([]),
  ]);
  const own = new Set([...mentioned, ...touched]);
  return { docs, ticketDocs: docs.filter((d) => own.has(d.path) || token.test(d.path)).map((d) => d.path) };
}
