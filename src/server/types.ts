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
  kind: "ticket" | "custom" | "rebase" | "shell"; // "ticket" = full work-phase lifecycle session; "custom" = standalone claude; "rebase" = one-off To-QA rebase; "shell" = plain login-shell terminal ($SHELL, or bash)
  id: string;            // tmux session name, e.g. "mojito-RIC-46-to-review"
  ticket: string;        // "RIC-46" (empty for custom sessions)
  launchStatus: string;  // Linear status name at launch (empty for custom sessions)
  model: string;         // "opus" | "sonnet" | "fable" | full id
  effort: Effort | "";   // "" for shell sessions, which have no model/effort
  autoAdvance: boolean;
  state: SessionState;
  cwd: string;
  createdAt: string;     // ISO
  message?: string;      // last alert message
  projectName?: string | null; // Linear project name resolved at launch, for auto/gate advance
  // Added after the fields above: sidecars persisted before this change lack them,
  // so readSidecar can yield `undefined` at runtime despite the types — callers must guard.
  title: string;         // Linear ticket title at launch, for the skill's launch context
  labels: string[];      // Linear label names at launch, for bug/feature classification
  // Pre-scaling profile when diff-scaling downgraded a review launch (absent otherwise),
  // so the UI can tell an automatic downgrade from a user's explicit choice.
  scaledFrom?: { model: string; effort: Effort };
}

export interface TicketSummary {
  identifier: string;
  title: string;
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
