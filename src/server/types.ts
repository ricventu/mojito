export type SessionState = "starting" | "running" | "needs-input" | "done" | "failed";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type HookEventName = "PermissionRequest" | "Notification" | "Stop" | "SessionEnd";

export interface SessionMeta {
  id: string;            // tmux session name, e.g. "mojito-RIC-46-to-review"
  ticket: string;        // "RIC-46"
  launchStatus: string;  // Linear status name at launch, e.g. "Planned"
  model: string;         // "opus" | "sonnet" | "fable" | full id
  effort: Effort;
  autoAdvance: boolean;
  state: SessionState;
  cwd: string;
  createdAt: string;     // ISO
  message?: string;      // last alert message
}

export interface TicketSummary {
  identifier: string;
  title: string;
  statusName: string;
  statusType: string;    // triage | backlog | unstarted | started | completed | canceled
  project: string | null;
  labels: string[];
}

export interface AppConfig {
  port: number;
  token: string;
  linearApiKey: string;
  stateDir: string;
  projectsPath: string;
}
