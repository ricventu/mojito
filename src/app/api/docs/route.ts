import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveDocsTarget, docsDeps } from "@/server/docTarget";
import { listDocs } from "@/server/docFiles";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const target = resolveDocsTarget(new URL(req.url), docsDeps());
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.code });
  return NextResponse.json({ root: target.root, label: target.label, files: listDocs(target.root) });
}
