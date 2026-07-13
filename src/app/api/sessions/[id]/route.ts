import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { killSession } from "@/server/tmux";
import { removeSidecar } from "@/server/sidecar";
import { updateAutoAdvance } from "@/server/updateSession";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  await killSession(id);
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  if (typeof body?.autoAdvance !== "boolean") return new NextResponse("autoAdvance must be a boolean", { status: 400 });
  const next = updateAutoAdvance(id, body.autoAdvance, { registry: getRegistry(), bus: getBus() });
  if (!next) return new NextResponse("not found", { status: 404 });
  return NextResponse.json(next);
}
