import type { BoardTickets, TicketSummary } from "@mojito/shared";
import type { EventBus } from "../events/bus";
import type { LinearClient } from "../linear/client";

export const POLL_MS = 45_000;

interface Deps {
  linear: Pick<LinearClient, "listOpenIssues">;
  projects: () => string[];
  bus: EventBus;
  now?: () => number;
}

/**
 * The board's ticket list. A failed poll never throws: it is recorded in the
 * snapshot (last list kept and marked stale, or an empty list with the error
 * when nothing was ever fetched), so Linear being down cannot take the server down.
 */
export class TicketCache {
  private tickets: TicketSummary[] = [];
  private fetchedAt: number | null = null;
  private stale = false;
  private error: string | null = null;
  private inflight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now;
  }

  snapshot(): BoardTickets {
    return { tickets: this.tickets, fetchedAt: this.fetchedAt, stale: this.stale, error: this.error };
  }

  get(identifier: string): TicketSummary | null {
    return this.tickets.find((t) => t.identifier === identifier) ?? null;
  }

  /** Concurrent callers share the in-flight request; one after it settles starts a new one. */
  refresh(): Promise<void> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    let changed: boolean;
    try {
      const next = await this.deps.linear.listOpenIssues(this.deps.projects());
      changed = JSON.stringify(next) !== JSON.stringify(this.tickets) || this.stale || this.error !== null;
      this.tickets = next;
      this.fetchedAt = this.now();
      this.stale = false;
      this.error = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stale = this.fetchedAt !== null;
      changed = stale !== this.stale || message !== this.error;
      this.stale = stale;
      this.error = message;
    }
    if (changed) this.deps.bus.emit({ type: "tickets.changed" });
  }
}
