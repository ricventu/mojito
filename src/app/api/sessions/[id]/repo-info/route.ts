import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { currentBranch } from "@/server/projectStack";
import { repoRootFromWorktree } from "@/server/merge";
import { basename } from "node:path";

export interface RepoInfo {
  /** The repo root path, or "" when the cwd is not inside a git repo. */
  repoRoot: string;
  /** The current branch name, or "" when on a detached HEAD or git fails. */
  branch: string;
  /** True when the session's cwd is the repo root itself (not a worktree). */
  isRepoRoot: boolean;
}

/**
 * The repo root and current branch for a session (RIC-333). The board uses this to
 * show whether a session is in the repo root or a worktree, and which branch it is on.
 *
 * Answers an empty result when the session is unknown or its cwd is not inside a git
 * repo — the UI then hides the indicator rather than showing a broken one.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const session = getRegistry().get(id);
  if (!session) return NextResponse.json({ error: "unknown session" }, { status: 404 });

  const cwd = session.cwd ?? "";
  if (!cwd) return NextResponse.json({ repoRoot: "", branch: "", isRepoRoot: false });

  let repoRoot = "";
  let branch = "";
  let isRepoRoot = false;

  try {
    // repoRootFromWorktree returns the .git common dir's parent when cwd is a worktree,
    // or null when cwd is not inside a git repo. When cwd IS the repo root itself, git
    // reports the repo dir as the common dir, so the function returns the repo root.
    const found = await repoRootFromWorktree(cwd);
    if (found) {
      repoRoot = found;
      isRepoRoot = cwd === found;
    }
  } catch {
    // Not a git repo or git failed — leave empty and let the UI hide the indicator.
  }

  try {
    branch = await currentBranch(cwd);
  } catch {
    // Detached HEAD or git failed — leave empty.
  }

  return NextResponse.json({ repoRoot, branch, isRepoRoot } satisfies RepoInfo);
}
