import type { SessionMeta, TaskRecord } from "./types";

export type MojitoEvent =
  | { type: "session.updated"; session: SessionMeta }
  | { type: "session.removed"; id: string }
  | { type: "task.updated"; task: TaskRecord }
  | { type: "tickets.changed" };
