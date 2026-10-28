import type { SessionState } from "@mojito/shared";

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PermissionRequest"
  | "Notification"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SessionEnd";

export const HOOK_EVENTS: readonly HookEventName[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PermissionRequest",
  "Notification",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
];

export function isHookEvent(event: string): event is HookEventName {
  return (HOOK_EVENTS as readonly string[]).includes(event);
}

export interface HookOutcome {
  state: SessionState;
  alert: string | null;
}

/**
 * The fields of a hook's own JSON body (claude's hook input, posted by the curl as the request
 * body) that Mojito reads. Anything missing, mistyped or unparseable is simply absent, so a
 * hook with no usable body is handled exactly as it was before the body was read at all.
 */
export interface HookPayload {
  /** SessionEnd: why the session ended (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`). */
  reason?: string;
}

export function hookPayload(body: unknown): HookPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const b = body as Record<string, unknown>;
  const out: HookPayload = {};
  if (typeof b.reason === "string") out.reason = b.reason;
  return out;
}

/**
 * A hook that says nothing about the session's state and must change nothing. `/clear` fires
 * SessionEnd (reason `clear`) and then SessionStart in the same, still-live claude: taken at
 * its word, the first would mark the session `ended` for good and the second could not revive it.
 */
export function isNoiseHook(event: HookEventName, payload: HookPayload): boolean {
  return event === "SessionEnd" && payload.reason === "clear";
}

/**
 * What a Claude Code hook says about a session. `ended` is final as far as hooks go: a session
 * that has ended never comes back through one (a relaunch is a new row), so a late SessionStart
 * or an idle Notification must not resurrect it — only the boot-time reconcile does, for a row
 * whose tmux is demonstrably alive. Only needs-input carries an alert; every other state clears it.
 */
export function mapHook(event: HookEventName, current: SessionState): HookOutcome {
  if (current === "ended") return { state: "ended", alert: null };
  switch (event) {
    case "SessionStart":
    case "UserPromptSubmit":
    case "PostToolUse":
      return { state: "running", alert: null };
    case "PermissionRequest":
      return { state: "needs-input", alert: "claude chiede un permesso" };
    case "Notification":
      return { state: "needs-input", alert: "claude ti sta aspettando" };
    case "PreToolUse":
      // Only AskUserQuestion is hooked for PreToolUse (hookSettings matcher).
      return { state: "needs-input", alert: "claude ti fa una domanda" };
    case "Stop":
      return { state: "idle", alert: null };
    case "SessionEnd":
      return { state: "ended", alert: null };
  }
}
