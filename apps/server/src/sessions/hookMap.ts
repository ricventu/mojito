import type { EndReason, SessionState } from "@mojito/shared";

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
  /** Set when the outcome is `ended`: why, as far as the hook can tell. */
  endReason?: EndReason;
}

/**
 * The fields of a hook's own JSON body (claude's hook input, posted by the curl as the request
 * body) that Mojito reads. Anything missing, mistyped or unparseable is simply absent, so a
 * hook with no usable body is handled exactly as it was before the body was read at all.
 */
export interface HookPayload {
  /** SessionEnd: why the session ended (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`). */
  reason?: string;
  /** Notification: what it is about (`permission_prompt`, `idle_prompt`, `auth_success`, …). */
  notification_type?: string;
  /** SessionStart: how the session started (`startup`, `resume`, `clear`, `compact`). */
  source?: string;
  /**
   * Stop: how many of the session's background tasks are agents still at work (`background_tasks`
   * entries that are a subagent, a workflow or a teammate, and not finished). Shells are not
   * counted: a dev server left running in the background is not the session working.
   */
  backgroundAgents?: number;
}

// The `background_tasks` types that are an agent working on the session's behalf; their report
// comes back as a new turn (UserPromptSubmit), and a Stop follows it.
const AGENT_TASKS = new Set(["subagent", "workflow", "teammate"]);
// Statuses that say a listed task is over. Claude lists only what is in flight, so this is a guard.
const FINISHED_TASKS = new Set(["completed", "failed", "killed", "stopped", "cancelled", "canceled", "done"]);

function countBackgroundAgents(tasks: unknown): number | undefined {
  if (!Array.isArray(tasks)) return undefined;
  return tasks.filter((t) => {
    if (!t || typeof t !== "object") return false;
    const { type, status } = t as Record<string, unknown>;
    return typeof type === "string" && AGENT_TASKS.has(type) && !(typeof status === "string" && FINISHED_TASKS.has(status));
  }).length;
}

export function hookPayload(body: unknown): HookPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const b = body as Record<string, unknown>;
  const out: HookPayload = {};
  if (typeof b.reason === "string") out.reason = b.reason;
  if (typeof b.notification_type === "string") out.notification_type = b.notification_type;
  if (typeof b.source === "string") out.source = b.source;
  const agents = countBackgroundAgents(b.background_tasks);
  if (agents !== undefined) out.backgroundAgents = agents;
  return out;
}

// The Notification types that mean claude is blocked on the human. `idle_prompt` is not one:
// it fires ~60s after every Stop, and taken as needs-input it turned every finished session
// amber; nor is `auth_success`. `elicitation_url_dialog` is the browser-URL twin of
// `elicitation_dialog` and blocks the same way.
const WAITING_NOTIFICATIONS = new Set(["permission_prompt", "elicitation_dialog", "elicitation_url_dialog"]);

/**
 * A hook that says nothing about the session's state and must change nothing. `/clear` fires
 * SessionEnd (reason `clear`) and then SessionStart in the same, still-live claude: taken at
 * its word, the first would mark the session `ended` for good and the second could not revive it.
 * A Notification counts only when its type says claude is waiting on the human; one with no
 * type at all still counts, since missing a real prompt costs more than a false amber.
 */
export function isNoiseHook(event: HookEventName, payload: HookPayload): boolean {
  if (event === "SessionEnd") return payload.reason === "clear";
  if (event === "Notification") {
    return payload.notification_type !== undefined && !WAITING_NOTIFICATIONS.has(payload.notification_type);
  }
  return false;
}

/**
 * What a Claude Code hook says about a session. `ended` is final as far as hooks go: a session
 * that has ended never comes back through one (a relaunch is a new row), so a late SessionStart
 * or an idle Notification must not resurrect it — only the boot-time reconcile does, for a row
 * whose tmux is demonstrably alive. Only needs-input carries an alert; every other state clears it.
 * The SessionStart of a `/clear` leaves claude at an empty prompt, waiting: idle, not running —
 * no Stop follows it to say so. A Stop while a background agent is still at work is not idle
 * either: the turn is over, the work is not, and its report will start the next turn. Shown idle,
 * such a session looks finished — one was closed mid-verification that way.
 */
export function mapHook(event: HookEventName, current: SessionState, payload: HookPayload = {}): HookOutcome {
  if (current === "ended") return { state: "ended", alert: null };
  switch (event) {
    case "SessionStart":
      return { state: payload.source === "clear" ? "idle" : "running", alert: null };
    case "UserPromptSubmit":
    case "PostToolUse":
      return { state: "running", alert: null };
    case "PermissionRequest":
      return { state: "needs-input", alert: "claude is asking for a permission" };
    case "Notification":
      return { state: "needs-input", alert: "claude is waiting for you" };
    case "PreToolUse":
      // Only AskUserQuestion is hooked for PreToolUse (hookSettings matcher).
      return { state: "needs-input", alert: "claude is asking you a question" };
    case "Stop":
      return { state: (payload.backgroundAgents ?? 0) > 0 ? "running" : "idle", alert: null };
    case "SessionEnd":
      return { state: "ended", alert: null, endReason: endReasonFromHook(payload.reason) };
  }
}

/**
 * A SessionEnd's reason as an `EndReason`: `prompt_input_exit` (`/exit`, Ctrl-D) and `logout` are
 * the human's doing; anything else (`other`: a signal, the terminal closing) is not.
 */
export function endReasonFromHook(reason: string | undefined): EndReason {
  return reason === "prompt_input_exit" || reason === "logout" ? "exited" : "other";
}
