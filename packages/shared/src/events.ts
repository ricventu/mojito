import type { PeerSnapshot, SessionMeta, TaskRecord } from "./types";

export type MojitoEvent =
  | { type: "session.updated"; session: SessionMeta }
  | { type: "session.removed"; id: string }
  | { type: "task.updated"; task: TaskRecord }
  | { type: "tickets.changed" }
  | { type: "settings.updated" }
  /** A project was created, edited or deleted. */
  | { type: "projects.changed" }
  /** A peer's snapshot changed (connected, a session moved, went offline). */
  | { type: "peers.updated"; peer: PeerSnapshot };
