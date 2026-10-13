import { NextResponse } from "next/server";
import { getConfig } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { gitTargetDeps, resolveGitTarget } from "@/server/gitTarget";
import { readGitGraph } from "@/server/gitGraph";
import { gitFailureDetail } from "@/server/worktree";

// One page of a repo's commit graph. Read-only: it never fetches, so it shows whatever
// the last fetch left.
export async function GET(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const target = resolveGitTarget(url, gitTargetDeps());
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.code });
  const skip = url.searchParams.get("skip") ?? "0";
  if (!/^\d+$/.test(skip)) return NextResponse.json({ error: "invalid skip" }, { status: 400 });
  try {
    const graph = await readGitGraph(target.cwd, { skip: Number(skip), highlight: target.highlight });
    return NextResponse.json({ label: target.label, ...graph });
  } catch (e) {
    return NextResponse.json({ error: gitFailureDetail(e) }, { status: 409 });
  }
}
