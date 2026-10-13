import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { gitTargetDeps, resolveGitTarget } from "@/server/gitTarget";
import { isValidHash, readCommit } from "@/server/gitGraph";
import { gitFailureDetail } from "@/server/worktree";

// One commit's message and changed files, for the graph's details sheet. The hash is
// validated before anything else runs, so a query value can never reach git as a flag.
export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const hash = url.searchParams.get("hash") ?? "";
  if (!isValidHash(hash)) return NextResponse.json({ error: "invalid hash" }, { status: 400 });
  const target = resolveGitTarget(url, gitTargetDeps());
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.code });
  try {
    const details = await readCommit(target.cwd, hash);
    if (!details) return NextResponse.json({ error: "unknown commit" }, { status: 404 });
    return NextResponse.json(details);
  } catch (e) {
    return NextResponse.json({ error: gitFailureDetail(e) }, { status: 409 });
  }
}
