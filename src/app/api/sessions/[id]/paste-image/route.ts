import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { validateImages } from "@/server/imageUpload";
import { storePastedImages } from "@/server/pasteImageStore";
import { CLAUDE_IMAGE_MAX_BYTES } from "@/lib/imageConstants";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const meta = getRegistry().get(id);
  if (!meta) return new NextResponse("not found", { status: 404 });
  if (!meta.cwd) return new NextResponse("session has no working directory", { status: 400 });

  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const parsed = validateImages(body?.images, CLAUDE_IMAGE_MAX_BYTES);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.files.length === 0) return NextResponse.json({ error: "no images" }, { status: 400 });

  let result;
  try {
    result = storePastedImages(meta.cwd, id, parsed.files);
  } catch {
    return NextResponse.json({ error: "failed to store image" }, { status: 500 });
  }
  return NextResponse.json({ paths: result.paths });
}
