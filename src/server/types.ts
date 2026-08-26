// "idle" = an interactive (custom) session that finished its turn and is calmly waiting
// for the user — distinct from "needs-input", which is a genuine block (permission / question).
export type SessionState = "starting" | "running" | "idle" | "needs-input" | "done" | "failed";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PermissionRequest"
  | "Notification"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SessionEnd";

export interface SessionMeta {
  // "ticket" = full work-phase lifecycle session; "custom" = standalone claude;
  // "intake" = the New-ticket session that turns a draft into a Linear issue (RIC-251) —
  // a custom session in every mechanical respect (no ticket, no lifecycle, mapCustomHook
  // drives its state), but it says so on the board instead of hiding among the bare
  // claude sessions the human started themselves; "shell" = plain login-shell terminal
  // ($SHELL, or bash).
  kind: "ticket" | "custom" | "intake" | "shell";
  id: string;            // tmux session name, e.g. "mojito-RIC-46-work"
  ticket: string;        // "RIC-46" (empty for custom sessions)
  launchStatus: string;  // Linear status name at launch (empty for custom sessions)
  model: string;         // "opus" | "sonnet" | "fable" | full id
  effort: Effort | "";   // "" for shell sessions, which have no model/effort
  state: SessionState;
  cwd: string;
  createdAt: string;     // ISO
  message?: string;      // last alert message
  projectName?: string | null; // Linear project name resolved at launch, used to resolve the repo and for verdict actions
  // Added after the fields above: sidecars persisted before this change lack them,
  // so readSidecar can yield `undefined` at runtime despite the types — callers must guard.
  title: string;         // Linear ticket title at launch, goes into the session context file
  labels: string[];      // Linear label names at launch, for bug/feature classification
}

export interface TicketSummary {
  identifier: string;
  title: string;
  /** The issue's own Linear url, straight from the API — the header links the ticket id to it. */
  url: string;
  statusName: string;
  statusType: string;    // triage | backlog | unstarted | started | completed | canceled
  project: string | null;
  labels: string[];
  assignedToMe: boolean;  // assigned to the Linear API key's owner (false when unassigned)
}

export interface AppConfig {
  port: number;
  token: string;
  linearApiKey: string;
  stateDir: string;
  projectsPath: string;
}
