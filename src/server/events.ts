import type { SessionState } from "./types.js";

export type MojitoEvent =
  | { type: "session.state"; id: string; state: SessionState }
  | { type: "session.alert"; id: string; kind: string; ticket: string; message: string };

export class EventBus {
  private subs = new Set<(e: MojitoEvent) => void>();
  subscribe(fn: (e: MojitoEvent) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  emit(e: MojitoEvent): void {
    for (const fn of this.subs) fn(e);
  }
}
