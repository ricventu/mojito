import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveStack, currentBranch } from "@/server/projectStack";
import { launchStackResolveSession } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const target = resolveStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!target || !target.pullable) return new NextResponse("not found", { status: 404 });
  const branch = await currentBranch(target.path);
  const res = await launchStackResolveSession(
    { projectName: target.project, branch },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json({ meta: res.meta }, { status: 201 });
}
