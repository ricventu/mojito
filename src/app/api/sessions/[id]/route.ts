import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { closeSession } from "@/server/tmux";
import { removeSidecar } from "@/server/sidecar";
import { cleanupPastedImages } from "@/server/pasteImageStore";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const cwd = getRegistry().get(id)?.cwd;
  await closeSession(id);
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  if (cwd) { try { cleanupPastedImages(cwd, id); } catch { /* best-effort */ } }
  return new NextResponse(null, { status: 204 });
}
