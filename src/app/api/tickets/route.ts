import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { listOpenIssues } from "@/server/linear";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  try {
    return NextResponse.json(await listOpenIssues(cfg.linearApiKey));
  } catch {
    return new NextResponse("linear error", { status: 502 });
  }
}
