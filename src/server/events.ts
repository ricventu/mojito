import type { SessionState } from "./types";

export type MojitoEvent =
  | { type: "session.state"; id: string; state: SessionState }
  | { type: "session.alert"; id: string; kind: string; ticket: string; message: string }
  // Something about a session other than its state changed (its `hidden` flag). Carries
  // no payload: every client refetches the session list on any event anyway.
  | { type: "session.updated"; id: string };

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
