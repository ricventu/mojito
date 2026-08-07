import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { listOpenIssues, createIssue, uploadImage } from "@/server/linear";
import { validateImages } from "@/server/imageUpload";
import { loadProjectMap, teamKeyForProject } from "@/server/projects";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  try {
    return NextResponse.json(await listOpenIssues(cfg.linearApiKey));
  } catch {
    return new NextResponse("linear error", { status: 502 });
  }
}

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!title) return NextResponse.json({ error: "empty title" }, { status: 400 });
  const parsed = validateImages(body.images);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  let imageUrls: string[];
  try {
    imageUrls = await Promise.all(parsed.files.map((f) => uploadImage(cfg.linearApiKey, f)));
  } catch {
    return NextResponse.json({ error: "image upload failed" }, { status: 502 });
  }
  const teamKey = teamKeyForProject(loadProjectMap(cfg.projectsPath), body.projectName ?? null);
  if (!teamKey) return NextResponse.json({ error: "no team configured" }, { status: 422 });
  const description = imageUrls.length ? `${brief}\n\n${imageUrls.map((u) => `![](${u})`).join("\n")}` : brief;
  try {
    const created = await createIssue(cfg.linearApiKey, {
      teamKey, title, description, projectName: body.projectName ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "issue creation failed" }, { status: 502 });
  }
}
