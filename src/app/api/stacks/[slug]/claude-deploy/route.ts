import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveStack } from "@/server/projectStack";
import { launchCustomSession } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

/**
 * The whole instruction, deliberately one line: every project deploys differently, and
 * a session opened in the repo root can read that repo's own scripts, Makefile and docs
 * for itself. Anything Mojito added here would be a guess about a procedure it does not
 * own — this is not the server's own guarded self-update flow (see selfUpdate.ts), which
 * is the one deploy Mojito does know how to run.
 *
 * Italian on purpose, verbatim as asked for: it is the human's own phrasing of the
 * chore, not a Mojito-authored prompt template like the ones in src/server/prompts/.
 */
const PROMPT = "fai pull e deploy in produzione";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const target = resolveStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!target) return new NextResponse("not found", { status: 404 });
  // Opus at high effort: a production deploy is the one chore here where a wrong turn is
  // expensive and there is no status name to derive the stage's defaults from.
  const res = await launchCustomSession(
    { projectName: target.project, model: "opus", effort: "high", prompt: PROMPT },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json({ meta: res.meta }, { status: 201 });
}
