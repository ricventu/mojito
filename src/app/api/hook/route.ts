import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { getIssueStatus } from "@/server/linear";
import { handleHook } from "@/server/hookHandler";
import { runAutoAdvance } from "@/server/autoAdvanceRunner";
import type { HookEventName } from "@/server/types";

const VALID: HookEventName[] = ["PermissionRequest", "Notification", "Stop", "SessionEnd"];

export async function POST(req: Request) {
  // Localhost-only: reject if the connection is not from loopback.
  const host = req.headers.get("host") ?? "";
  if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("session") ?? "";
  const event = url.searchParams.get("event") as HookEventName | null;
  if (!event || !VALID.includes(event)) return new NextResponse("bad event", { status: 400 });
  await req.text(); // drain the forwarded hook body (not needed for our logic)
  const cfg = getConfig();
  await handleHook(id, event, {
    registry: getRegistry(),
    bus: getBus(),
    getIssueStatus: (ticket) => getIssueStatus(cfg.linearApiKey, ticket),
    onAutoAdvance: (meta, newStatus) => void runAutoAdvance(meta, newStatus),
  });
  return new NextResponse(null, { status: 204 });
}
