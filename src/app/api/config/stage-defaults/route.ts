import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { readEffective, writeOverrides } from "@/server/stageDefaults";
import { validateStageDefaults } from "@/lib/stageDefaults";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(readEffective());
}

export async function PUT(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const parsed = validateStageDefaults(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  writeOverrides(parsed.value);
  return NextResponse.json(readEffective());
}
