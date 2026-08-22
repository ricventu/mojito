import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getProjectWorktrees } from "@/server/projectWorktrees";

/**
 * The linked worktrees of a project's repo, for the New session sheet's Worktree field
 * (RIC-243). Read-only, and never an error: a project with nothing to offer — General, an
 * unmapped name, a repo without worktrees — answers an empty list.
 */
export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const projectName = new URL(req.url).searchParams.get("projectName") || null;
  return NextResponse.json(getProjectWorktrees(cfg.projectsPath, projectName));
}
