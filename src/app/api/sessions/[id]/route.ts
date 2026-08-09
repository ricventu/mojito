import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { closeSession } from "@/server/tmux";
import { removeSidecar } from "@/server/sidecar";
import { cleanupPastedImages } from "@/server/pasteImageStore";
import { clearTicketAssets } from "@/server/ticketAssets";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const cwd = getRegistry().get(id)?.cwd;
  await closeSession(id);
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  // Up to 20 x 10 MB per session — unlike the few-KB context file, this genuinely
  // accumulates if it is not cleared on delete.
  try { clearTicketAssets(cfg.stateDir, id); } catch { /* best-effort */ }
  if (cwd) { try { cleanupPastedImages(cwd, id); } catch { /* best-effort */ } }
  return new NextResponse(null, { status: 204 });
}
