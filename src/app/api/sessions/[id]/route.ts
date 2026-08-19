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
  // Mojito removes a session only once claude has actually exited — closeSession has
  // no force path, so a session that is still up is still up. Dropping its
  // registration here would strand it: alive, holding its tmux name against the next
  // launch, and invisible in the list. Report it instead and leave everything in place.
  const { closed } = await closeSession(id);
  if (!closed) {
    return NextResponse.json(
      { error: "claude is still running in this session — it did not exit. Open it and quit claude, then dismiss it." },
      { status: 409 },
    );
  }
  getRegistry().remove(id);
  removeSidecar(cfg.stateDir, id);
  // Up to 20 x 10 MB per session — unlike the few-KB context file, this genuinely
  // accumulates if it is not cleared on delete.
  try { clearTicketAssets(cfg.stateDir, id); } catch { /* best-effort */ }
  if (cwd) { try { cleanupPastedImages(cwd, id); } catch { /* best-effort */ } }
  return new NextResponse(null, { status: 204 });
}
