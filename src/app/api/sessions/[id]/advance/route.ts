import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus } from "@/server/linear";
import { launchSession } from "@/server/launch";
import { hasSession, newSession, pipePane, closeSession } from "@/server/tmux";
import { tmuxName } from "@/server/sessionKey";
import { supersedeSession } from "@/server/supersede";

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
  // Gracefully close and deregister it first so launchSession doesn't see it as a
  // duplicate and silently drop the verdict.
  const registry = getRegistry();
  const newId = tmuxName(prev.ticket, status);
  if (await hasSession(newId)) {
    await closeSession(newId);
    registry.remove(newId); // also removes the sidecar
  }
  const res = await launchSession(
    { ticket: prev.ticket, status, model: prev.model, effort: prev.effort,
      autoAdvance: prev.autoAdvance, projectName: prev.projectName ?? null, trailingArg: arg,
      title: prev.title ?? "", labels: prev.labels ?? [] },
    { registry, stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.reason === "duplicate" ? 409 : 422 });
  // Retire the originating gate session when the new stage runs under a distinct id.
  if (res.meta.id !== id) await supersedeSession(id, { closeSession, registry });
  return NextResponse.json(res.meta, { status: 201 });
}
