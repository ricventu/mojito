import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
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
  // A worktree the human picked from the sheet (RIC-243). Only a non-empty string travels:
  // it ends up in resolveWorktreePick, whose comparison would read anything else as "no
  // match" and silently fall back — so a malformed body stops here instead. Applies to
  // every kind, and to both the ticket-scoped and project-scoped shapes of custom/shell.
  const picked = typeof body.worktree === "string" && body.worktree ? { worktree: body.worktree } : {};
  if (body.kind === "custom") {
    const res = await launchCustomSession(
      { projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high",
        ...picked,
        ...(typeof body.ticket === "string" && body.ticket
          ? { ticket: body.ticket, status: body.status ?? "", title: body.title ?? "",
              labels: Array.isArray(body.labels) ? body.labels : [],
              createWorktree: Boolean(body.createWorktree), baseBranch: body.baseBranch }
          : {}) },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
  if (body.kind === "shell") {
    const res = await launchShellSession(
      { projectName: body.projectName ?? null,
        ...picked,
        ...(typeof body.ticket === "string" && body.ticket
          ? { ticket: body.ticket, status: body.status ?? "", title: body.title ?? "",
              labels: Array.isArray(body.labels) ? body.labels : [],
              createWorktree: Boolean(body.createWorktree), baseBranch: body.baseBranch }
          : {}) },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
  // The session id has to be known before the launch, because the assets are written into
  // a directory named after it. tmuxName validates both the ticket and the status (a
  // missing or non-string status throws inside statusSlug), so either being malformed is
  // a 422 here rather than an unhandled throw inside launchSession.
  let id: string;
  try { id = tmuxName(body.ticket, body.status); } catch { return NextResponse.json({ error: "invalid ticket or status" }, { status: 422 }); }
  // The asset directory is named after the session id, and preparing it destroys the
  // previous contents — so the duplicate check has to happen before the download, not
  // only inside launchSession, or a rejected 409 would wipe a live session's assets.
  if (await hasSession(id)) return NextResponse.json({ error: "duplicate", id }, { status: 409 });
  let content: IssueContent = { description: "", attachments: [] };
  try {
    content = await getIssueContent(cfg.linearApiKey, body.ticket);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`sessions route: getIssueContent failed for ${body.ticket}: ${message}`);
    // launch anyway with empty description
  }
  // Never rejects: an unreachable asset costs itself, not the launch.
  const prepared = await prepareTicketAssets({
    stateDir: cfg.stateDir, id, description: content.description, attachments: content.attachments,
    download: (url) => downloadLinearAsset(cfg.linearApiKey, url, MAX_ASSET_BYTES),
  });
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      projectName: body.projectName ?? null,
      title: body.title ?? "", labels: Array.isArray(body.labels) ? body.labels : [],
      description: content.description, assets: prepared.assets, attachments: prepared.attachments,
      createWorktree: Boolean(body.createWorktree), baseBranch: body.baseBranch, ...picked },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane, bus: getBus() },
  );
  if (!res.ok) {
    const status = res.reason === "duplicate" ? 409 : 422;
    return NextResponse.json({ error: res.reason, id: res.id }, { status });
  }
  if (body.status === "Backlog" || body.status === "Todo") {
    // Best-effort: the session is already running, so a failed status write must not fail
    // the request — but it does leave the board behind, so say so rather than swallowing it.
    try {
      await setIssueStatus(cfg.linearApiKey, body.ticket, "In Progress");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`sessions route: setIssueStatus failed for ${body.ticket}: ${message}`);
    }
  }
  return NextResponse.json(res.meta, { status: 201 });
}
