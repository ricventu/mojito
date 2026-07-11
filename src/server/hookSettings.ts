import type { HookEventName } from "./types.js";

const EVENTS: HookEventName[] = ["PermissionRequest", "Notification", "Stop", "SessionEnd"];

function command(sessionId: string, port: number, event: HookEventName): string {
  const url = `http://127.0.0.1:${port}/api/hook?session=${encodeURIComponent(sessionId)}&event=${event}`;
  // -sS quiet, -m 2 hard timeout, forward stdin as the body, never fail the hook.
  return `curl -sS -m 2 -X POST "${url}" -H "Content-Type: application/json" --data-binary @- >/dev/null 2>&1 || true`;
}

export function buildHookSettings(sessionId: string, port: number): { hooks: Record<string, unknown[]> } {
  const hooks: Record<string, unknown[]> = {};
  for (const event of EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: command(sessionId, port, event) }] }];
  }
  return { hooks };
}
