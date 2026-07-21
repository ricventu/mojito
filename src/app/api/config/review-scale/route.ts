import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { readAutoScale, writeAutoScale } from "@/server/scaleSettings";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json({ autoScale: readAutoScale() });
}

export async function PUT(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  if (typeof body?.autoScale !== "boolean") {
    return NextResponse.json({ error: "autoScale must be a boolean" }, { status: 422 });
  }
  writeAutoScale(body.autoScale);
  return NextResponse.json({ autoScale: readAutoScale() });
}
