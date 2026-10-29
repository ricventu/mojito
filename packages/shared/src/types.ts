import type { Effort, Model } from "./models";
import type { Prompts } from "./prompts";

export type SessionState = "starting" | "running" | "needs-input" | "idle" | "ended";
export type SessionKind = "ticket" | "claude" | "shell";

export interface StatusDefault {
  model: Model;
  effort: Effort;
}

/** A named board filter: `search` is the filter bar's text, stored verbatim. */
export interface Favorite {
  name: string;
  search: string;
}

export interface Settings {
  statusDefaults: Record<string, StatusDefault>;
  /** Always complete: a prompt never edited answers its default. */
  prompts: Prompts;
  favorites: Favorite[];
}

export interface ProjectRow {
  name: string;
  path: string;
  teamKey: string;
}

export interface TicketSummary {
  identifier: string;
  title: string;
  url: string;
  statusName: string;
  statusType: string;
  project: string | null;
  labels: string[];
  assignedToMe: boolean;
}

export interface BoardTickets {
  tickets: TicketSummary[];
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
}

export interface SessionMeta {
  id: string;
  kind: SessionKind;
  project: string | null;
  ticket: string | null;
  cwd: string;
  model: Model | null;
  effort: Effort | null;
  state: SessionState;
  alert: string | null;
  createdAt: number;
  lastEventAt: number;
  /** Sidebar-only: tucked into the sidebar's Hidden footer. Nothing behavioural reads it. */
  hidden: boolean;
}

export type TaskStatus = "queued" | "running" | "done" | "failed";

export interface TaskRecord {
  id: string;
  type: "create-ticket";
  input: { project: string; note: string; imageUrls: string[] };
  status: TaskStatus;
  log: string[];
  error: string | null;
  result: { identifier: string; url: string } | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}
