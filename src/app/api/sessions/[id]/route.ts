import { NextResponse } from "next/server";
import { getBus, getConfig, getRegistry } from "@/server/app";
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

/**
 * Hide a session from the sidebar, or bring it back — `{ hidden: boolean }` and nothing
 * else. Stored on the registration (and so the sidecar) rather than in the browser, so
 * that a session tucked away on the Mac is gone from the phone's sidebar too. The event
 * is what tells those other clients: `/ws/events` is the only thing that refreshes them.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if (!isHiddenPatch(body)) {
    return NextResponse.json({ error: "expected { hidden: boolean }" }, { status: 400 });
  }
  // Checked against the in-memory registry, not left to patch(): that falls back to a
  // sidecar on disk, and would resurrect a session the list no longer shows.
  if (!getRegistry().get(id)) return NextResponse.json({ error: "no such session" }, { status: 404 });
  const meta = getRegistry().patch(id, { hidden: body.hidden });
  getBus().emit({ type: "session.updated", id });
  return NextResponse.json(meta);
}

function isHiddenPatch(body: unknown): body is { hidden: boolean } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "hidden" && typeof (body as { hidden: unknown }).hidden === "boolean";
}
