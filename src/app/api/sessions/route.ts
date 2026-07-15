import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { launchSession } from "@/server/launch";
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
