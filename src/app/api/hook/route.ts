import { NextResponse } from "next/server";
import { getConfig, getRegistry, getBus } from "@/server/app";
import { tokenFromHeaders } from "@/server/auth";
import { setIssueStatus } from "@/server/linear";
import { handleHook } from "@/server/hookHandler";
import { readTranscriptTitle } from "@/server/sessionTitle";
import { readSessionResult, clearSessionResult } from "@/server/sessionResult";
import type { HookEventName } from "@/server/types";

const VALID: HookEventName[] = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"];

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!tokenFromHeaders(req.headers, cfg.token)) return new NextResponse("unauthorized", { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("session") ?? "";
  const event = url.searchParams.get("event") as HookEventName | null;
  if (!event || !VALID.includes(event)) return new NextResponse("bad event", { status: 400 });
  const raw = await req.text(); // forwarded hook payload (JSON on stdin from Claude Code)
  let payload: { sessionTitle?: string; transcriptPath?: string } | undefined;
  try {
    const json = JSON.parse(raw) as { session_title?: unknown; transcript_path?: unknown };
    payload = {};
    if (typeof json.session_title === "string") payload.sessionTitle = json.session_title;
    if (typeof json.transcript_path === "string") payload.transcriptPath = json.transcript_path;
  } catch {
    /* non-JSON or empty body — no title to forward */
  }
  await handleHook(id, event, {
    registry: getRegistry(),
    bus: getBus(),
    readResult: (sessionId) => readSessionResult(cfg.stateDir, sessionId),
    moveToQa: (ticket) => setIssueStatus(cfg.linearApiKey, ticket, "To QA"),
    moveToDone: (ticket) => setIssueStatus(cfg.linearApiKey, ticket, "Done"),
    clearResult: (sessionId) => clearSessionResult(cfg.stateDir, sessionId),
    readTranscriptTitle,
  }, payload);
  return new NextResponse(null, { status: 204 });
}
