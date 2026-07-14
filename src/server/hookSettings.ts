import type { HookEventName } from "./types.js";

const EVENTS: HookEventName[] = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification", "PostToolUse", "Stop", "SessionEnd"];

// EVENTS and MATCHED_EVENTS must be disjoint: any event in both would have its unmatched
// entry (line 22) clobbered by the matched entry (line 25) when buildHookSettings writes
// into the same hooks[event] map.
// PreToolUse fires for every tool, so it MUST be scoped by a matcher: only AskUserQuestion
// should drive the "the agent is asking a question" (needs-input) signal. PostToolUse is
// intentionally unmatched (all tools, incl. subagent tool calls) — any finished tool means
// the agent is working again, which clears a stale needs-input (mapHook: PostToolUse -> running).
const MATCHED_EVENTS: { event: HookEventName; matcher: string }[] = [
  { event: "PreToolUse", matcher: "AskUserQuestion" },
];

function command(sessionId: string, port: number, event: HookEventName, token: string): string {
  const url = `http://127.0.0.1:${port}/api/hook?session=${encodeURIComponent(sessionId)}&event=${event}`;
  const tok = token.replace(/'/g, "'\\''");
  return `curl -sS -m 2 -X POST "${url}" -H "Content-Type: application/json" -H 'x-mojito-token: ${tok}' --data-binary @- >/dev/null 2>&1 || true`;
}

export function buildHookSettings(sessionId: string, port: number, token: string): { hooks: Record<string, unknown[]> } {
  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: command(sessionId, port, event, token) }] }];
  }
  for (const { event, matcher } of MATCHED_EVENTS) {
    hooks[event] = [{ matcher, hooks: [{ type: "command", command: command(sessionId, port, event, token) }] }];
  }
  return { hooks };
}
