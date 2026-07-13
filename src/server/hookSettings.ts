import type { HookEventName } from "./types.js";

const EVENTS: HookEventName[] = ["PermissionRequest", "Notification", "Stop", "SessionEnd"];

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
  return { hooks };
}
