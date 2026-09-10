"use client";
import { Check } from "lucide-react";
import { FolderGit } from "lucide-react";

/**
 * Shows where a session is checked out: "Repo root" with a green check when the
 * session's cwd is the repo root itself, or the worktree directory name when it is
 * not. The current branch rides on the same line — the one thing the human needs to
 * know before opening the terminal (RIC-333).
 *
 * Empty when the server could not answer (not a git repo, session gone, ...): the
 * caller hides the whole row on that signal, so a missing answer is never a broken
 * indicator.
 */
export default function RepoRootBadge({ repoRoot, branch, isRepoRoot }: {
  repoRoot: string;
  branch: string;
  isRepoRoot: boolean;
}) {
  if (!repoRoot) return null;
  const location = isRepoRoot ? "Repo root" : basename(repoRoot);
  return (
    <span className="repo-root-badge">
      {isRepoRoot ? (
        <Check size={14} className="repo-root-check" aria-hidden="true" />
      ) : (
        <FolderGit size={14} className="repo-root-worktree" aria-hidden="true" />
      )}
      <span className="repo-root-label">{location}</span>
      {branch && <span className="repo-root-branch">{branch}</span>}
    </span>
  );
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
