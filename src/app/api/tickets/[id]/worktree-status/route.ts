import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { validateTicket } from "@/server/sessionKey";
import { getTicketWorktreeStatus } from "@/server/ticketWorktreeStatus";

/**
 * Whether the ticket already has a worktree, and — when it doesn't — what the launch
 * sheet needs to ask "create one?" before starting a session: the repo's local branches,
 * and its detected default. Read-only.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  const url = new URL(req.url);
  const projectName = url.searchParams.get("projectName") || null;
  const title = url.searchParams.get("title") || "";
  const status = await getTicketWorktreeStatus(cfg.projectsPath, id, projectName, title);
  return NextResponse.json(status);
}
