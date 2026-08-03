import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { setIssueAssignee } from "@/server/linear";
import { validateTicket } from "@/server/sessionKey";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  let body: unknown;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const mine = (body as { mine?: unknown })?.mine;
  if (typeof mine !== "boolean") return new NextResponse("mine must be a boolean", { status: 400 });

  try {
    await setIssueAssignee(cfg.linearApiKey, id, mine);
  } catch {
    return new NextResponse("linear error", { status: 502 });
  }
  return NextResponse.json({ ok: true, mine }, { status: 200 });
}
