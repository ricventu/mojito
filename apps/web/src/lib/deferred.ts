export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Actions run after a grace period that Undo can cancel (the board's quick Done). A key is
 * pending from `schedule` until its action settles, so what it hides stays hidden until the
 * write has landed; Undo works only before the action starts. Lives outside React, so leaving
 * the page neither runs nor drops a pending action.
 */
export class DeferredActions {
  private readonly waiting = new Map<string, unknown>();
  private pending: ReadonlySet<string> = new Set();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly timers: Timers = browserTimers) {}

  /** False when `key` is already pending: a double tap is one action. */
  schedule(key: string, run: () => Promise<unknown> | unknown, ms: number): boolean {
    if (this.pending.has(key)) return false;
    const handle = this.timers.set(() => {
      this.waiting.delete(key);
      void Promise.resolve()
        .then(run)
        .catch(() => {})
        .finally(() => this.remove(key));
    }, ms);
    this.waiting.set(key, handle);
    this.update(new Set([...this.pending, key]));
    return true;
  }

  /** Cancels `key` if its action has not started; false once it has (or was never scheduled). */
  undo(key: string): boolean {
    if (!this.waiting.has(key)) return false;
    this.timers.clear(this.waiting.get(key));
    this.waiting.delete(key);
    this.remove(key);
    return true;
  }

  /** The pending keys; a new set on every change (a stable snapshot for `useSyncExternalStore`). */
  snapshot = (): ReadonlySet<string> => this.pending;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private remove(key: string) {
    const next = new Set(this.pending);
    next.delete(key);
    this.update(next);
  }

  private update(next: ReadonlySet<string>) {
    this.pending = next;
    for (const listener of this.listeners) listener();
  }
}
