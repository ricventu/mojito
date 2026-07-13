import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus } from "@/server/linear";
import { launchSession } from "@/server/launch";
import { hasSession, newSession, pipePane, killSession } from "@/server/tmux";
import { tmuxName } from "@/server/sessionKey";
import { removeSidecar } from "@/server/sidecar";

const VALID_ARGS = ["approve", "reject", "local", "mr"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const { arg } = body;
  if (!VALID_ARGS.includes(arg)) return new NextResponse("invalid arg", { status: 400 });
  const prev = getRegistry().get(id);
  if (!prev) return new NextResponse("not found", { status: 404 });
  const status = await getIssueStatus(cfg.linearApiKey, prev.ticket);
  // The gate session that triggered this advance shares the same (ticket, status)
  // pair as the id we're about to launch, which produces the SAME tmux name.
  // Kill and deregister it first so launchSession doesn't see it as a duplicate
  // and silently drop the verdict.
  const newId = tmuxName(prev.ticket, status);
  if (await hasSession(newId)) {
    await killSession(newId);
    getRegistry().remove(newId);
    removeSidecar(cfg.stateDir, newId);
  }
  const res = await launchSession(
    { ticket: prev.ticket, status, model: prev.model, effort: prev.effort,
      autoAdvance: prev.autoAdvance, projectName: prev.projectName ?? null, trailingArg: arg,
      title: prev.title ?? "", labels: prev.labels ?? [] },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.reason === "duplicate" ? 409 : 422 });
  return NextResponse.json(res.meta, { status: 201 });
}
