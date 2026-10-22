import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { validateTicket, parseIdentifier } from "@/server/sessionKey";
import { launchImproveSession } from "@/server/launch";
import { hasSession, newSession, pipePane } from "@/server/tmux";

/**
 * Launch an improve session for an existing ticket. The session reads the issue
 * through the Linear MCP, rewrites its title and description, and updates it in
 * place. Returns the session meta so the client can open the terminal.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  try { validateTicket(id); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
  let body: unknown;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const b = body as { projectName?: unknown; title?: unknown; labels?: unknown };
  const projectName = typeof b.projectName === "string" ? b.projectName : null;
  const title = typeof b.title === "string" ? b.title : "";
  const labels = Array.isArray(b.labels) ? b.labels.filter((l): l is string => typeof l === "string") : [];
  const teamKey = parseIdentifier(id).teamKey;

  const res = await launchImproveSession(
    { ticket: id, projectName, title, labels, teamKey },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json(res.meta, { status: 201 });
}
