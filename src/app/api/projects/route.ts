import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { loadProjectMap, listMappedProjects } from "@/server/limeProjects";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const projects = listMappedProjects(loadProjectMap(cfg.projectsPath)).map((p) => p.name);
  return NextResponse.json({ projects });
}
