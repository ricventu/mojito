import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveStack } from "@/server/projectStack";
import { launchCustomSession } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

// Seeds a plain project-scoped Claude session (RIC-115) with enough context to write the
// script together with the human — Mojito never guesses what a repo's worktrees need.
const PROMPT = [
  "Mojito runs `scripts/init-worktree.sh` once, right after it creates a fresh git",
  "worktree for a Linear ticket (at `.claude/worktrees/<ticket>-<slug>`), with that worktree",
  "as the script's working directory. If the script is missing, Mojito still creates the",
  "worktree but skips setup and warns in the session's terminal.",
  "",
  "Write that script together with me: whatever this project's worktrees need before a",
  "session can start working in them — installing dependencies, copying local env files,",
  "anything else specific to this repo.",
].join("\n");

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const target = resolveStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!target) return new NextResponse("not found", { status: 404 });
  const res = await launchCustomSession(
    { projectName: target.project, model: "opus", effort: "high", prompt: PROMPT },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json({ meta: res.meta }, { status: 201 });
}
