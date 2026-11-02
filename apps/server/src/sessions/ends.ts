import type { EndReason, MojitoEvent, SessionMeta } from "@mojito/shared";
import type { SessionsRepo } from "../db/sessions";
import type { EventBus } from "../events/bus";
import type { LivePane } from "../tmux/tmux";
import { markEnded } from "./reconcile";

/** How long after an end the journal is read: systemd logs the OOM kill as the scope fails. */
export const OOM_CHECK_DELAY_MS = 2000;
/** How far before the end an OOM kill still counts as what ended the session. */
export const OOM_WINDOW_MS = 60_000;

// Only an end nobody asked for can be an OOM kill. An `/exit` stays what it was, even
// when a test process in the same pane was OOM-killed a minute before.
const INVOLUNTARY: ReadonlySet<EndReason> = new Set(["other", "gone"]);

export interface EndWatchDeps {
  sessions: SessionsRepo;
  bus: EventBus;
  now(): number;
  /** The systemd scope of a pane's process (`oom.ts#paneScope`), null when there is none. */
  paneScope(pid: number): string | null;
  /** Whether the OOM killer hit `scope` at or after `sinceMs` (`oom.ts#oomKilledSince`). */
  oomKilledSince(scope: string, sinceMs: number): Promise<boolean>;
  log?(line: string): void;
  schedule?(fn: () => void, ms: number): void;
}

/**
 * Says why each session ended, beyond what the hooks can tell. Fed by the pane poll
 * (`observe`): a non-ended row whose tmux is no longer listed has ended (`gone`) — without it, a
 * claude killed outright (no SessionEnd) kept showing `running` until someone opened it or Mojito
 * restarted. And it remembers each pane's systemd scope while the pane is alive, because once it
 * is gone the scope is too: an involuntary end (`other`, `gone`) whose scope logged an OOM kill
 * within `OOM_WINDOW_MS` becomes `oom`.
 *
 * Every end is logged once per reason (`session <id> ended: <reason>`), which is what to look for
 * in the service log to know how a session went.
 */
export class EndWatch {
  private readonly scopes = new Map<string, { pid: number; scope: string | null }>();
  private readonly logged = new Map<string, EndReason | null>();
  private readonly log: (line: string) => void;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: EndWatchDeps) {
    this.log = deps.log ?? ((line) => console.log(line));
    this.schedule = deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.unsubscribe = deps.bus.subscribe((e) => this.onEvent(e));
  }

  stop(): void {
    this.unsubscribe();
  }

  /**
   * One round of the pane poll: remember new panes' scopes, and end the rows tmux no longer has.
   * `before` is the table as it was read just before tmux was asked: a row only appears once its
   * tmux session exists, so each of those had a session when `panes` was listed. A row launched
   * while tmux answered is not among them, and is left for the next round.
   */
  observe(panes: Map<string, LivePane>, before: SessionMeta[]): void {
    for (const [id, pane] of panes) {
      if (pane.pid === null || this.scopes.get(id)?.pid === pane.pid) continue;
      this.scopes.set(id, { pid: pane.pid, scope: this.deps.paneScope(pane.pid) });
    }
    for (const row of before) {
      if (row.state === "ended" || panes.has(row.id)) continue;
      const current = this.deps.sessions.get(row.id);
      // The same row still live: not relaunched under its id, not ended by a hook meanwhile.
      if (current && current.state !== "ended" && current.createdAt === row.createdAt) markEnded(row.id, this.deps);
    }
  }

  private onEvent(e: MojitoEvent): void {
    if (e.type !== "session.updated") return;
    const { id, state, endReason } = e.session;
    if (state !== "ended") {
      // Live again (a relaunch reuses `mj-<TICKET>`, a reconcile revives): its next end is news.
      this.logged.delete(id);
      return;
    }
    if (this.logged.has(id) && this.logged.get(id) === endReason) return;
    this.logged.set(id, endReason);
    this.log(`session ${id} ended: ${endReason ?? "unknown"}`);
    const scope = this.scopes.get(id)?.scope ?? null;
    if (scope && endReason && INVOLUNTARY.has(endReason)) {
      const since = e.session.lastEventAt - OOM_WINDOW_MS;
      this.schedule(() => void this.checkOom(id, scope, since), OOM_CHECK_DELAY_MS);
    }
  }

  private async checkOom(id: string, scope: string, sinceMs: number): Promise<void> {
    try {
      if (!(await this.deps.oomKilledSince(scope, sinceMs))) return;
      const row = this.deps.sessions.get(id);
      // Still the end it was checked for: not relaunched (or resumed) meanwhile.
      if (!row || row.state !== "ended" || !row.endReason || !INVOLUNTARY.has(row.endReason)) return;
      const session = this.deps.sessions.patch(id, { endReason: "oom" });
      if (session) this.deps.bus.emit({ type: "session.updated", session });
    } catch (err) {
      console.error(`checking ${id} for an OOM kill failed:`, err);
    }
  }
}
