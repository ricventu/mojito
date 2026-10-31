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
  /**
   * The name claude gives the session — `/rename`'s, else its own automatic title — read from
   * the tmux pane title (`sessions/titles.ts`); null until it has one. The last one is kept.
   */
  title: string | null;
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

export type GitOp = "pull" | "push";

/**
 * What a project's Pull or Push answered (`POST /api/projects/:name/pull|push`). A pull that
 * cannot finish cleanly (a rebase conflict, uncommitted changes in the way) leaves the repo as it
 * was and hands it to a Claude session in the checkout: `conflict` names it, `alreadyOpen` when
 * the project's git session was already running and was not launched again.
 */
export type GitSyncResult =
  | { status: "updated"; branch: string; from: string; to: string; commits: number }
  | { status: "up-to-date"; branch: string }
  | { status: "pushed"; branch: string; commits: number; pulled: number }
  | { status: "conflict"; session: SessionMeta; alreadyOpen: boolean };
