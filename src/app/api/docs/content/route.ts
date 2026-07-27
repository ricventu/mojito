import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { resolveDocsTarget, docsDeps } from "@/server/docTarget";
import { resolveDocPath, readDoc } from "@/server/docFiles";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const target = resolveDocsTarget(url, docsDeps());
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.code });
  const rel = url.searchParams.get("path");
  if (!rel) return NextResponse.json({ error: "path required" }, { status: 400 });
  // A rejected path is a 400, never a 404: the guard's null means "not allowed",
  // and saying "not found" would leak whether the file exists.
  const abs = resolveDocPath(target.root, rel);
  if (!abs) return NextResponse.json({ error: "invalid path" }, { status: 400 });
  const read = readDoc(abs);
  if (!read.ok) {
    return read.reason === "too-large"
      ? NextResponse.json({ error: "document too large" }, { status: 413 })
      : NextResponse.json({ error: "document not found" }, { status: 404 });
  }
  return NextResponse.json({ path: rel, content: read.content });
}
