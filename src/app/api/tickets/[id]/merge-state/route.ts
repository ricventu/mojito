import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { hasNothingToMerge } from "@/server/ticketMergeState";
import { validateTicket } from "@/server/sessionKey";

/**
 * Whether a QA approve on this ticket would have anything to merge. Read by the QA gate
 * before it offers a verdict: a branch already merged — or work that never took a branch —
 * needs no merge, only a status write. Read-only and best-effort.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  const projectName = new URL(req.url).searchParams.get("projectName") || null;
  return NextResponse.json({ nothingToMerge: await hasNothingToMerge(cfg.projectsPath, id, projectName) });
}
