import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { pullStack } from "@/server/projectStack";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { slug } = await params;
  const r = await pullStack(slug, { projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  if (r.ok) return NextResponse.json(r.result, { status: 200 });
  return NextResponse.json(r.detail ? { error: r.error, detail: r.detail } : { error: r.error }, { status: r.code });
}
