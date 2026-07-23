import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { startStack } from "@/server/projectStack";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const r = await startStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code });
  return NextResponse.json({ status: r.status }, { status: 200 });
}
