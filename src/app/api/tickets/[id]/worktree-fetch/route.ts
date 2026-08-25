import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { validateTicket } from "@/server/sessionKey";
import { fetchTicketRemotes } from "@/server/fetchTicketRemotes";

/**
 * Fetches the ticket repo's remotes and answers the refreshed worktree status: the Fetch
 * action beside the launch sheet's Base branch field, for picking a remote base that is
 * actually current.
 *
 * POST rather than GET on worktree-status, which stays read-only: this one writes the repo's
 * remote-tracking refs (and prunes the dead ones).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  const url = new URL(req.url);
  const projectName = url.searchParams.get("projectName") || null;
  const title = url.searchParams.get("title") || "";
  return NextResponse.json(await fetchTicketRemotes(cfg.projectsPath, id, projectName, title));
}
