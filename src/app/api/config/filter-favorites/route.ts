import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { readFavorites, writeFavorites } from "@/server/filterFavorites";
import { validateFavorites } from "@/lib/filterFavorites";

/**
 * The board's saved filter favourites (RIC-306). Whole-list GET/PUT, in the shape
 * /api/config/stage-defaults already has: every edit the row offers — save, rename,
 * reorder, delete — is a rewrite of the same short array, so per-favourite verbs would
 * buy nothing and give reordering no endpoint at all.
 *
 * Wrapped in an object rather than answering a bare array, so the response has
 * somewhere to grow.
 */
export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json({ favorites: readFavorites() });
}

export async function PUT(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  let body;
  try { body = await req.json(); } catch { return new NextResponse("bad json", { status: 400 }); }
  const parsed = validateFavorites((body as { favorites?: unknown } | null)?.favorites);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  writeFavorites(parsed.value);
  return NextResponse.json({ favorites: readFavorites() });
}
