import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { listOpenIssues, uploadImage } from "@/server/linear";
import { validateImages } from "@/server/imageUpload";
import { launchIntakeSession } from "@/server/launch";
import { writeTicketDraft } from "@/server/ticketDraft";
import { loadProjectMap, listMappedProjects, teamKeyForProject } from "@/server/projects";
import { hasSession, newSession, pipePane } from "@/server/tmux";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  // Scoped to the mapped projects: the board only shows what Mojito can
  // actually open a session in. See listOpenIssues for the empty-map and no-project cases.
  const projects = listMappedProjects(loadProjectMap(cfg.projectsPath)).map((p) => p.name);
  try {
    return NextResponse.json(await listOpenIssues(cfg.linearApiKey, projects));
  } catch {
    return new NextResponse("linear error", { status: 502 });
  }
}

/**
 * New ticket. Mojito no longer creates the issue: it prepares the draft and hands it to an
 * intake session, which writes the title and the description and creates the issue itself
 * through the Linear MCP (see launchIntakeSession). What stays server-side is the part the
 * session cannot do — the images, since LINEAR_API_KEY never leaves this process. The 201
 * body is that session's meta, so the client can land straight in its terminal, where the
 * MCP write asks for permission.
 */
export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return NextResponse.json({ error: "empty brief" }, { status: 400 });
  const parsed = validateImages(body.images);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const projectName = body.projectName ?? null;
  const teamKey = teamKeyForProject(loadProjectMap(cfg.projectsPath), projectName);
  if (!teamKey) return NextResponse.json({ error: "no team configured" }, { status: 422 });
  let imageUrls: string[];
  try {
    imageUrls = await Promise.all(parsed.files.map((f) => uploadImage(cfg.linearApiKey, f)));
  } catch {
    return NextResponse.json({ error: "image upload failed" }, { status: 502 });
  }
  const draftPath = writeTicketDraft(cfg.stateDir, { brief, teamKey, projectName, imageUrls });
  const res = await launchIntakeSession(
    { projectName, teamKey, draftPath, hasImages: imageUrls.length > 0 },
    { registry: getRegistry(), stateDir: cfg.stateDir, port: cfg.port, token: cfg.token,
      projectsPath: cfg.projectsPath, hasSession, newSession, pipePane, bus: getBus() },
  );
  if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 422 });
  return NextResponse.json(res.meta, { status: 201 });
}
