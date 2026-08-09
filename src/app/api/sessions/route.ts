import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { launchSession, launchCustomSession, launchShellSession } from "@/server/launch";
import { getIssueContent, downloadLinearAsset, setIssueStatus, type IssueContent } from "@/server/linear";
import { prepareTicketAssets, MAX_ASSET_BYTES } from "@/server/ticketAssets";
import { tmuxName } from "@/server/sessionKey";
import { hasSession, newSession, pipePane } from "@/server/tmux";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(getRegistry().all());
}

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  if (body.kind === "custom") {
    const res = await launchCustomSession(
      { projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high",
        ...(typeof body.ticket === "string" && body.ticket
          ? { ticket: body.ticket, status: body.status ?? "", title: body.title ?? "",
              labels: Array.isArray(body.labels) ? body.labels : [] }
          : {}) },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
  if (body.kind === "shell") {
    const res = await launchShellSession(
      { projectName: body.projectName ?? null,
        ...(typeof body.ticket === "string" && body.ticket
          ? { ticket: body.ticket, status: body.status ?? "", title: body.title ?? "",
              labels: Array.isArray(body.labels) ? body.labels : [] }
          : {}) },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
  // The session id has to be known before the launch, because the assets are written into
  // a directory named after it. tmuxName validates the ticket, so a malformed one is a 422
  // here rather than an unhandled throw inside launchSession.
  let id: string;
  try { id = tmuxName(body.ticket, body.status); } catch { return NextResponse.json({ error: "invalid ticket" }, { status: 422 }); }
  let content: IssueContent = { description: "", attachments: [] };
  try { content = await getIssueContent(cfg.linearApiKey, body.ticket); } catch { /* launch anyway with empty description */ }
  // Never rejects: an unreachable asset costs itself, not the launch.
  const prepared = await prepareTicketAssets({
    stateDir: cfg.stateDir, id, description: content.description, attachments: content.attachments,
    download: (url) => downloadLinearAsset(cfg.linearApiKey, url, MAX_ASSET_BYTES),
  });
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      projectName: body.projectName ?? null,
      title: body.title ?? "", labels: Array.isArray(body.labels) ? body.labels : [],
      description: content.description, assets: prepared.assets, attachments: prepared.attachments },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) {
    const status = res.reason === "duplicate" ? 409 : 422;
    return NextResponse.json({ error: res.reason, id: res.id }, { status });
  }
  if (body.status === "Backlog" || body.status === "Todo") {
    try { await setIssueStatus(cfg.linearApiKey, body.ticket, "In Progress"); } catch { /* board update is best-effort */ }
  }
  return NextResponse.json(res.meta, { status: 201 });
}
