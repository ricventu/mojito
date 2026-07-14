import { NextResponse } from "next/server";
import { getConfig, getRegistry } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { hasSession } from "@/server/tmux";
import { sweepOrphans } from "@/server/sweep";

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const removed = await sweepOrphans({ registry: getRegistry(), hasSession });
  return NextResponse.json({ removed });
}
