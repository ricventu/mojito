export interface GitPaths {
  /** `git rev-parse --show-toplevel` — the working tree the cwd sits in. null = not a repo. */
  toplevel: string | null;
  /** The main checkout behind it (`--git-common-dir`'s parent), which is what projects.json maps. */
  mainRepo: string | null;
}

export interface ResolvedProject {
  /** null = no mapped project, which the caller launches as a General session. */
  projectName: string | null;
  /** Sent to the launch API only when the cwd is a *linked* worktree of the mapped repo. */
  worktree?: string;
}

const trim = (path: string) => path.replace(/\/+$/, "");

/**
 * Which project — and which worktree of it — the directory the command ran in belongs to.
 * Pure: the caller has already asked git and resolved both paths through realpath.
 *
 * The toplevel is matched *first* so that a projects.json entry which is itself a linked
 * worktree keeps its own name and sends no `worktree` — it is the repo root as far as
 * Mojito is concerned, and resolveWorktreePick would not list it under itself.
 * Otherwise a match on the main checkout gives the project, with the toplevel riding
 * along as the pick whenever it differs.
 */
export function resolveProjectForPath(git: GitPaths, projects: { name: string; path: string }[]): ResolvedProject {
  const toplevel = git.toplevel ? trim(git.toplevel) : null;
  if (!toplevel) return { projectName: null };
  const mainRepo = git.mainRepo ? trim(git.mainRepo) : toplevel;
  const byPath = (target: string) => projects.find((p) => trim(p.path) === target);

  const here = byPath(toplevel);
  if (here) return { projectName: here.name };
  const main = byPath(mainRepo);
  if (!main) return { projectName: null };
  return { projectName: main.name, worktree: toplevel };
}
