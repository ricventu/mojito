import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus, setIssueStatus, postComment } from "@/server/linear";
import { resolveQaVerdict } from "@/server/qaVerdict";
import { resolveTicketVerdict } from "@/server/ticketVerdict";
import { tmuxName, validateTicket } from "@/server/sessionKey";
import { supersedeSession } from "@/server/supersede";
import { closeSession } from "@/server/tmux";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const { arg, reason } = body;

  const result = await resolveTicketVerdict(
    { ticket: id, arg, reason },
    {
      getIssueStatus: (t) => getIssueStatus(cfg.linearApiKey, t),
      resolveVerdict: (i) =>
        resolveQaVerdict(i, {
          setIssueStatus: (t, s) => setIssueStatus(cfg.linearApiKey, t, s),
          postComment: (t, b) => postComment(cfg.linearApiKey, t, b),
        }),
      supersedeStaleSession: async (t) => {
        const registry = getRegistry();
        const sid = tmuxName(t, "To QA");
        if (registry.get(sid)) await supersedeSession(sid, { closeSession, registry });
      },
    },
  );

  if (result.ok) return NextResponse.json({ ok: true, arg: result.arg }, { status: 200 });
  return NextResponse.json({ error: result.error }, { status: result.code });
}
