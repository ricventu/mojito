import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { listStacks } from "@/server/projectStack";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const stacks = await listStacks({ projectsPath: cfg.projectsPath, selfPath: process.cwd() });
  return NextResponse.json({ stacks });
}
