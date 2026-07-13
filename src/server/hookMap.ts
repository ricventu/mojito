import type { HookEventName, SessionState } from "./types.js";

export interface HookOutcome {
  state: SessionState;
  alert: { kind: "needs-input" | "stage-done" | "failed"; message: string } | null;
}

export function mapHook(event: HookEventName, statusAdvanced: boolean): HookOutcome {
  switch (event) {
    case "SessionStart":
      // claude has booted and is now working — leave the transient "starting" state.
      return { state: "running", alert: null };
    case "PermissionRequest":
      return { state: "needs-input", alert: { kind: "needs-input", message: "claude needs permission" } };
    case "Notification":
      return { state: "needs-input", alert: { kind: "needs-input", message: "claude needs your attention" } };
    case "PreToolUse":
      // AskUserQuestion fires PreToolUse the instant the prompt appears — the only
      // hook that signals "waiting for input" immediately (Notification is idle-timed).
      return { state: "needs-input", alert: { kind: "needs-input", message: "claude is asking a question" } };
    case "PostToolUse":
      // The question was answered; the agent is working again. No alert.
      return { state: "running", alert: null };
    case "Stop":
      return statusAdvanced
        ? { state: "done", alert: { kind: "stage-done", message: "stage complete" } }
        : { state: "needs-input", alert: { kind: "needs-input", message: "claude is waiting for you" } };
    case "SessionEnd":
      return statusAdvanced
        ? { state: "done", alert: { kind: "stage-done", message: "stage complete" } }
        : { state: "failed", alert: { kind: "failed", message: "session ended unexpectedly" } };
  }
}
