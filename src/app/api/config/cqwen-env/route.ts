import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json({
    baseUrl: cfg.cqwenBaseUrl,
    apiKey: cfg.cqwenApiKey,
    model: cfg.cqwenModel,
  });
}
