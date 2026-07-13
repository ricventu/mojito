import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { getIssueStatus } from "@/server/linear";
import { handleHook } from "@/server/hookHandler";
import { runAutoAdvance } from "@/server/autoAdvanceRunner";
import type { HookEventName } from "@/server/types";

const VALID: HookEventName[] = ["SessionStart", "PermissionRequest", "Notification", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("session") ?? "";
  const event = url.searchParams.get("event") as HookEventName | null;
  if (!event || !VALID.includes(event)) return new NextResponse("bad event", { status: 400 });
  await req.text(); // drain the forwarded hook body (not needed for our logic)
  await handleHook(id, event, {
    registry: getRegistry(),
    bus: getBus(),
    getIssueStatus: (ticket) => getIssueStatus(cfg.linearApiKey, ticket),
    onAutoAdvance: (meta, newStatus) => void runAutoAdvance(meta, newStatus),
  });
  return new NextResponse(null, { status: 204 });
}
