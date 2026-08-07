import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { launchSession, launchCustomSession, launchShellSession } from "@/server/launch";
import { getIssueDescription, setIssueStatus } from "@/server/linear";
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
  let description = "";
  try { description = await getIssueDescription(cfg.linearApiKey, body.ticket); } catch { /* launch anyway with empty description */ }
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      projectName: body.projectName ?? null,
      title: body.title ?? "", labels: Array.isArray(body.labels) ? body.labels : [],
      description },
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
