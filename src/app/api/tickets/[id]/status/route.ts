import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { setIssueStatus } from "@/server/linear";
import { validateTicket } from "@/server/sessionKey";
import { MANUAL_STATUSES } from "@/server/statusModel";

/**
 * The manual Backlog <-> Todo move (RIC-275).
 *
 * Validated against MANUAL_STATUSES rather than KNOWN_STATUSES: every other transition
 * belongs to a launch or a QA verdict, which own preconditions a bare status name
 * cannot carry, and an open target here would be a way to write Done over unmerged
 * work. Shaped like the assignee route beside it, which is the other endpoint whose
 * whole job is one Linear field.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  let body: unknown;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const status = (body as { status?: unknown })?.status;
  if (typeof status !== "string" || !MANUAL_STATUSES.includes(status)) {
    return new NextResponse(`status must be one of ${MANUAL_STATUSES.join(", ")}`, { status: 400 });
  }

  try {
    await setIssueStatus(cfg.linearApiKey, id, status);
  } catch {
    return new NextResponse("linear error", { status: 502 });
  }
  return NextResponse.json({ ok: true, status }, { status: 200 });
}
