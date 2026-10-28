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
 * What a Claude Code hook says about a session. `ended` is final: a session that has ended
 * never comes back (a relaunch is a new row), so a late SessionStart or an idle Notification
 * must not resurrect it. Only needs-input carries an alert; every other state clears it.
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
