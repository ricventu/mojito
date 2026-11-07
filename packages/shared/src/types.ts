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
  /**
   * The name claude gives the session — `/rename`'s, else its own automatic title — read from
   * the tmux pane title (`sessions/titles.ts`); null until it has one. The last one is kept.
   */
  title: string | null;
  /**
   * Why an `ended` session ended (`sessions/ends.ts`); null while it is live, and for a row that
   * ended before the reason was recorded. A peer that predates it sends no field at all.
   */
  endReason: EndReason | null;
  /**
   * claude's own id for the conversation (every hook's `session_id`; a `/clear` starts a new one),
   * what Resume hands `claude --resume`. Null until the first hook, and for a shell.
   */
  claudeSessionId: string | null;
}

/**
 * How a session ended (there is no Kill: claude is quit in its terminal). `exited`: claude quit
 * at the human's word (`/exit`, Ctrl-D, logout). `other`: claude ended for a reason of its own,
 * typically a signal. `oom`: the kernel's out-of-memory killer hit the session's pane (Linux,
 * read from its systemd scope).
 * `gone`: the tmux session vanished without claude saying so (a crash, a kill from outside, a reboot).
 */
export type EndReason = "exited" | "other" | "oom" | "gone";

export type TaskStatus = "queued" | "running" | "done" | "failed";

/**
 * Where a new ticket starts on Linear, by workflow state name: the New-ticket sheet's choice,
 * Todo first because it is the default. Mojito picks it, never the agent.
 */
export const INITIAL_STATUSES = ["Todo", "Backlog"] as const;
export type InitialStatus = (typeof INITIAL_STATUSES)[number];
export const DEFAULT_INITIAL_STATUS: InitialStatus = "Todo";
export const isInitialStatus = (v: unknown): v is InitialStatus => (INITIAL_STATUSES as readonly unknown[]).includes(v);

export interface TaskRecord {
  id: string;
  type: "create-ticket";
  input: { project: string; note: string; imageUrls: string[]; initialStatus: InitialStatus };
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

/**
 * `POST /api/projects/:name/clean` (RIC-528): the project's Clean session, `alreadyOpen` when it
 * was running and was not launched again.
 */
export interface CleanResult {
  session: SessionMeta;
  alreadyOpen: boolean;
}

/** `GET /api/projects/:name/worktrees`: the linked worktrees of the project's repository. */
export interface WorktreeCount {
  count: number;
}

/**
 * Another Mojito instance (`MOJITO_PEERS`) as this server sees it through its event socket.
 * Offline, `sessions` is empty: last-known states of a sleeping machine would lie.
 */
export interface PeerSnapshot {
  /** The first DNS label of its URL (the whole hostname for an IP or a dotless host). */
  name: string;
  /** As configured, no trailing slash: the origin its own client is served at. */
  url: string;
  online: boolean;
  /** Its live sessions: never an `ended` one. */
  sessions: SessionMeta[];
  /** Its mapped project names; paths never leave the peer. */
  projects: string[];
  /** Ticket → title, only for the tickets of `sessions`. */
  ticketTitles: Record<string, string>;
}

/** `GET /api/peers`: this instance's name (`MOJITO_NAME`) and its peers in configuration order. */
export interface PeersAnswer {
  self: string;
  peers: PeerSnapshot[];
}
