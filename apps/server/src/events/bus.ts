import type { MojitoEvent } from "@mojito/shared";

type Listener = (e: MojitoEvent) => void;

/** Fire-and-forget fan-out: nothing is buffered, nothing replays. */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: MojitoEvent): void {
    // Snapshot so a listener that unsubscribes mid-emit does not skew the walk.
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch (err) {
        console.error("event listener threw", err);
      }
    }
  }
}
