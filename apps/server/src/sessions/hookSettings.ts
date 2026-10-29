// The Claude Code hooks every claude session (ticket or free) is launched with, through
// `--settings <stateDir>/hooks/<id>.json`. Each one POSTs to Mojito's own hook endpoint,
// which maps the event onto the session's live state (Task 8's mapHook).

const EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Notification", "PostToolUse", "Stop", "SessionEnd"];

// Disjoint from EVENTS: an event in both would have its unmatched entry overwritten below.
// PreToolUse fires for every tool, so it MUST be scoped by a matcher — only AskUserQuestion
// means "the agent is asking a question" (needs-input). PostToolUse stays unmatched on
// purpose: any finished tool means the agent is working again, which clears a stale
// needs-input.
const MATCHED_EVENTS = [{ event: "PreToolUse", matcher: "AskUserQuestion" }];

// `|| true` and the 2s timeout: a hook must never fail claude, nor stall it while Mojito is down.
// `origin` is config.ts#selfOrigin: the configured host, loopback only for a wildcard bind.
function command(sessionId: string, origin: string, event: string, token: string): string {
  const url = `${origin}/api/hook?session=${encodeURIComponent(sessionId)}&event=${event}`;
  const tok = token.replace(/'/g, "'\\''");
  return `curl -sS -m 2 -X POST "${url}" -H "Content-Type: application/json" -H 'x-mojito-token: ${tok}' --data-binary @- >/dev/null 2>&1 || true`;
}

export function buildHookSettings(sessionId: string, origin: string, token: string): { hooks: Record<string, unknown[]> } {
  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: command(sessionId, origin, event, token) }] }];
  }
  for (const { event, matcher } of MATCHED_EVENTS) {
    hooks[event] = [{ matcher, hooks: [{ type: "command", command: command(sessionId, origin, event, token) }] }];
  }
  return { hooks };
}
