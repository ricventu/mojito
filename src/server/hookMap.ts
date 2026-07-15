import type { HookEventName, SessionState } from "./types.js";

export interface HookOutcome {
  state: SessionState;
  alert: { kind: "needs-input" | "stage-done" | "failed"; message: string } | null;
}

export function mapHook(event: HookEventName, statusAdvanced: boolean, currentState: SessionState): HookOutcome {
  // Terminal states (done/failed) are sticky against passive/idle signals. Claude Code
  // fires an idle Notification ~60s after a turn ends (and may emit a late permission or
  // AskUserQuestion prompt). Once a session has finished its stage, none of these must
  // drag it back to needs-input: the lifecycle is over, so no further PostToolUse /
  // UserPromptSubmit would ever arrive to clear it and the badge would stick forever
  // (RIC-117 — a "done" session showing "needs input" indefinitely). Only an explicit
  // activity signal revives a finished session to running (the cases below).
  const terminal = currentState === "done" || currentState === "failed";
  const activity = event === "SessionStart" || event === "UserPromptSubmit" || event === "PostToolUse";
  if (terminal && !activity) return { state: currentState, alert: null };

  switch (event) {
    case "SessionStart":
      // claude has booted and is now working — leave the transient "starting" state.
      return { state: "running", alert: null };
    case "UserPromptSubmit":
      // The user submitted a prompt — they have responded, so the session is no longer
      // waiting on the human. Back to running (clears a stale needs-input badge).
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
      // A tool call finished — the agent is working, not waiting. Clears needs-input
      // (an answered AskUserQuestion, a granted permission's tool, or resumed work).
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
