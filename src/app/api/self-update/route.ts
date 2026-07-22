import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { isSelfUpdateEnabled, runSelfUpdate } from "@/server/selfUpdate";
import { FfPullError } from "@/server/ffPull";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json({ enabled: isSelfUpdateEnabled() });
}

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  // Flag off: the endpoint does not exist for this instance.
  if (!isSelfUpdateEnabled()) return new NextResponse("not found", { status: 404 });
  try {
    return NextResponse.json(await runSelfUpdate());
  } catch (e) {
    if (e instanceof FfPullError) {
      const status = e.kind === "diverged" ? 409 : 500;
      return NextResponse.json({ error: e.kind, detail: e.detail }, { status });
    }
    return NextResponse.json({ error: "failed", detail: String(e) }, { status: 500 });
  }
}
