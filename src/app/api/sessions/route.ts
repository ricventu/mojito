import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { launchSession, launchCustomSession, launchNewTicketSession, launchRebaseSession } from "@/server/launch";
import { validateTicket } from "@/server/sessionKey";
import { validateImages } from "@/server/imageUpload";
import { uploadImage } from "@/server/linear";
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
  // Only the To Merge gate passes a trailing arg (the Stage-5 mode); whitelist it so the
  // launch command can never carry an arbitrary token.
  if (body.trailingArg !== undefined && body.trailingArg !== "local" && body.trailingArg !== "mr") {
    return NextResponse.json({ error: "invalid trailingArg" }, { status: 400 });
  }
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
  if (body.kind === "new-ticket") {
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    if (!brief) return NextResponse.json({ error: "empty brief" }, { status: 400 });
    const parsed = validateImages(body.images);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    let imageUrls: string[];
    try {
      imageUrls = await Promise.all(parsed.files.map((f) => uploadImage(cfg.linearApiKey, f)));
    } catch {
      return NextResponse.json({ error: "image upload failed" }, { status: 502 });
    }
    const res = await launchNewTicketSession(
      { brief, projectName: body.projectName ?? null, model: body.model ?? "opus", effort: body.effort ?? "high",
        images: imageUrls },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
    return NextResponse.json(res.meta, { status: 201 });
  }
  if (body.kind === "rebase") {
    try { validateTicket(body.ticket); } catch { return new NextResponse("invalid ticket", { status: 400 }); }
    const res = await launchRebaseSession(
      { ticket: body.ticket, projectName: body.projectName ?? null, title: body.title ?? "",
        labels: Array.isArray(body.labels) ? body.labels : [],
        model: body.model ?? "opus", effort: body.effort ?? "xhigh" },
      { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
        projectsPath: cfg.projectsPath, hasSession, newSession, pipePane },
    );
    if (!res.ok) {
      const status = res.reason === "duplicate" ? 409 : 422;
      return NextResponse.json({ error: res.reason, id: res.id }, { status });
    }
    return NextResponse.json(res.meta, { status: 201 });
  }
  const res = await launchSession(
    { ticket: body.ticket, status: body.status, model: body.model ?? "opus", effort: body.effort ?? "high",
      autoAdvance: !!body.autoAdvance, projectName: body.projectName ?? null,
      title: body.title ?? "", labels: Array.isArray(body.labels) ? body.labels : [],
      trailingArg: body.trailingArg },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token, projectsPath: cfg.projectsPath,
      hasSession, newSession, pipePane },
  );
  if (!res.ok) {
    const status = res.reason === "duplicate" ? 409 : 422;
    return NextResponse.json({ error: res.reason, id: res.id }, { status });
  }
  return NextResponse.json(res.meta, { status: 201 });
}
