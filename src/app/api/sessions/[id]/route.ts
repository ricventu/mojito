import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { killSession } from "@/server/tmux";
import { removeSidecar } from "@/server/sidecar";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  await killSession(id);
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  return new NextResponse(null, { status: 204 });
}
